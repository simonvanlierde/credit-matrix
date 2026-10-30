// biome-ignore-all lint/correctness/noNodejsModules: the CLI reads files, so its tests write some.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { run, USAGE } from "../cli";
import { NewerVersionError, toJson } from "../export/json";
import { createAuthor } from "../parse-authors";
import { decodeShareHash } from "../share-link";

const dir = mkdtempSync(join(tmpdir(), "credit-matrix-cli-"));

function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

const csv = file("team.csv", "Name,Conceptualization,Software\nJane Smith,100,66\nBob White,,100\n");

describe("credit-matrix statement", () => {
  it("prints the by-role statement by default", async () => {
    expect(await run(["statement", csv])).toBe(
      "CRediT: Conceptualization: Jane Smith; Software: Jane Smith, Bob White",
    );
  });

  it("takes a format and a locale", async () => {
    expect(await run(["statement", csv, "--format", "by-author"])).toBe(
      "CRediT: Jane Smith: Conceptualization, Software; Bob White: Software",
    );
    expect(await run(["statement", csv, "--locale", "fr"])).toContain("Conceptualisation\u00a0: Jane Smith");
  });

  it("keeps a ja statement in full-width punctuation", async () => {
    const japanese = await run(["statement", csv, "--locale", "ja"]);
    expect(japanese).toContain("：");
    expect(japanese.replace("CRediT: ", "")).not.toContain(": ");
  });

  it("takes a language without its region, or a region it does not offer", async () => {
    const german = await run(["statement", csv, "--locale", "de"]);
    expect(await run(["statement", csv, "--locale", "de-DE"])).toBe(german);
    const portuguese = await run(["statement", csv, "--locale", "pt-PT"]);
    expect(await run(["statement", csv, "--locale", "pt"])).toBe(portuguese);
    expect(await run(["statement", csv, "--locale", "pt-BR"])).toBe(portuguese);
    const chinese = await run(["statement", csv, "--locale", "zh-Hans"]);
    expect(await run(["statement", csv, "--locale", "zh"])).toBe(chinese);
    expect(await run(["statement", csv, "--locale", "zh-CN"])).toBe(chinese);
    expect(chinese).not.toBe(await run(["statement", csv]));
  });

  it("refuses an unknown format or locale", async () => {
    await expect(run(["statement", csv, "--format", "sideways"])).rejects.toThrow(/Unknown format/);
    await expect(run(["statement", csv, "--locale", "xx"])).rejects.toThrow(
      "Unknown locale: xx. Use one of en, fr, de, es, it, pt-PT, nl, zh-Hans, ja.",
    );
  });

  it("shows levels below Lead with --levels", async () => {
    const levels = file("levels.csv", "Name,Software\nJane Smith,50\nBob White,100\n");
    expect(await run(["statement", levels, "--levels"])).toBe("CRediT: Software: Jane Smith (Equal), Bob White");
  });

  it("prints CodeMeta roles for authors with an ORCID iD, and warns once for each person left out", async () => {
    const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const output = await run(["statement", fixture("export-codemeta.json"), "--format", "codemeta"]);
    expect(JSON.parse(output)).toEqual(JSON.parse(readFileSync(fixture("export-codemeta.expected.json"), "utf8")));
    expect(err.mock.calls.join("")).toBe(
      "credit-matrix: Ilse Marchetti is not an author, so their roles are left out.\n" +
        "credit-matrix: Tomas Okafor has no ORCID iD, so their roles are left out.\n",
    );
    vi.restoreAllMocks();
  });

  it("refuses a roster with no roles rather than print an empty statement", async () => {
    const names = file("names.txt", "Jane Smith, Bob White");
    await expect(run(["statement", names])).rejects.toThrow("No roles assigned yet: the statement is empty.");
    await expect(run(["statement", names, "--format", "codemeta"])).rejects.toThrow(
      "No roles assigned yet: the statement is empty.",
    );
  });

  it("refuses a spreadsheet or other binary file instead of reading it as names", async () => {
    const message = "Excel and other spreadsheet files are not read: save the sheet as CSV first.";
    await expect(run(["statement", file("team.xlsx", "Jane Smith")])).rejects.toThrow(message);
    await expect(run(["statement", file("team.bin", "PK\x03\x04Jane Smith")])).rejects.toThrow(message);
    await expect(run(["statement", file("team.dat", "Jane\0Smith")])).rejects.toThrow(message);
  });

  it("reads a UTF-16 file, as Excel's Unicode Text export writes, instead of refusing it", async () => {
    const text = "Name,Conceptualization\nJane Smith,100\n";
    const le = join(dir, "utf16le.csv");
    writeFileSync(le, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    expect(await run(["statement", le])).toBe("CRediT: Conceptualization: Jane Smith");
    const be = join(dir, "utf16be.csv");
    writeFileSync(be, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]));
    expect(await run(["statement", be])).toBe("CRediT: Conceptualization: Jane Smith");
  });
});

describe("credit-matrix convert", () => {
  it("writes each format, and reads its own JATS back without a browser", async () => {
    expect(await run(["convert", csv, "--to", "csv"])).toMatch(/^Name,ORCID/);
    expect(JSON.parse(await run(["convert", csv, "--to", "json"])).authors).toHaveLength(2);
    expect(await run(["convert", csv, "--to", "md"])).toContain("| Jane Smith |");
    expect(await run(["convert", csv, "--to", "crossref"])).toContain('<role vocab="credit" type="software"/>');
    const xml = file("team.xml", await run(["convert", csv, "--to", "jats"]));
    expect(await run(["statement", xml])).toBe(await run(["statement", csv]));
  });

  it("writes JATS without degree-contribution with --yes-no, and reads it back", async () => {
    const ticks = file("ticks.csv", "Name,Conceptualization,Software\nJane Smith,100,100\nBob White,,100\n");
    const xml = await run(["convert", ticks, "--to", "jats", "--yes-no"]);
    expect(xml).not.toContain("degree-contribution");
    expect(await run(["convert", ticks, "--to", "jats"])).toContain('degree-contribution="lead"');
    // A role with no level imports as contributed, so the statement survives the round trip.
    expect(await run(["statement", file("ticks.xml", xml)])).toBe(await run(["statement", ticks]));
  });

  it("writes Markdown in the --locale language", async () => {
    const md = await run(["convert", csv, "--to", "md", "--locale", "fr"]);
    expect(md).toContain("| Jane Smith | Conceptualisation");
    expect(md).toContain("Logiciel(s)");
    await expect(run(["convert", csv, "--to", "md", "--locale", "xx"])).rejects.toThrow("Unknown locale: xx.");
  });

  it("needs --to", async () => {
    await expect(run(["convert", csv])).rejects.toThrow(/--to json, csv, jats, crossref or md/);
  });
});

describe("credit-matrix ask", () => {
  const jane = createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] });
  const json = file("draft.json", toJson([jane, createAuthor("Bob White")]));

  it("prints a link for one contributor, by name or id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const link = await run(["ask", json, "--contributor", "jane smith"]);
    expect(link).toMatch(/^https:\/\/credit\.duinlab\.nl\/#s=/);
    const shared = await decodeShareHash(link.slice(link.indexOf("#")));
    expect(shared).toMatchObject({ claimId: jane.id, blank: false, sentAt: 1_700_000_000_000 });
    expect(shared?.authors.map((a) => a.name)).toEqual(["Jane Smith"]);
    expect(await run(["ask", json, "--contributor", jane.id])).toContain("#s=");
  });

  it("sends a blank row to another base URL", async () => {
    const link = await run([
      "ask",
      json,
      "--contributor",
      "Jane Smith",
      "--blank",
      "--base-url",
      "http://localhost:3000/",
    ]);
    expect(link.startsWith("http://localhost:3000/#s=")).toBe(true);
    const shared = await decodeShareHash(link.slice(link.indexOf("#")));
    expect(shared?.blank).toBe(true);
    expect(shared?.authors[0]?.contributions.every((c) => c.score === 0)).toBe(true);
  });

  it("finds a contributor by a first name or surname only they have", async () => {
    const link = await run(["ask", json, "--contributor", "SMITH"]);
    expect((await decodeShareHash(link.slice(link.indexOf("#"))))?.claimId).toBe(jane.id);
    expect(await run(["ask", json, "--contributor", "bob"])).toContain("#s=");
  });

  it("finds a contributor whose name is typed decomposed", async () => {
    const jose = createAuthor("Jos\u00E9 Garc\u00EDa");
    const accents = file("accents.json", toJson([jose, createAuthor("Bob White")]));
    const link = await run(["ask", accents, "--contributor", "Jose\u0301 Garci\u0301a"]);
    expect((await decodeShareHash(link.slice(link.indexOf("#"))))?.claimId).toBe(jose.id);
  });

  it("lists the contributors when none or several match", async () => {
    const twins = file("twins.json", toJson([createAuthor("Jane Smith"), createAuthor("Jane Doe")]));
    await expect(run(["ask", twins, "--contributor", "jane"])).rejects.toThrow(
      "jane matches more than one contributor: Jane Smith, Jane Doe. Give the full name or id.",
    );
    await expect(run(["ask", json, "--contributor", "Nobody"])).rejects.toThrow(
      "No contributor named or with id Nobody. Contributors: Jane Smith, Bob White.",
    );
    await expect(run(["ask", json])).rejects.toThrow(/needs --contributor/);
  });
});

describe("credit-matrix usage", () => {
  it("prints usage for --help, and refuses no command, an unknown one or a missing file", async () => {
    await expect(run([])).rejects.toThrow("Give a command: statement, convert, ask.");
    expect(await run(["statement", "--help"])).toBe(USAGE);
    await expect(run(["sideways", csv])).rejects.toThrow("Unknown command: sideways.");
    await expect(run(["statment", csv])).rejects.toThrow("Unknown command: statment. Did you mean 'statement'?");
    await expect(run(["statement"])).rejects.toThrow(/needs a file/);
  });

  it("prints the package version for --version or -v", async () => {
    expect(await run(["--version"])).toMatch(/^\d+\.\d+\.\d+/);
    expect(await run(["-v"])).toBe(await run(["--version"]));
  });

  it("names the failing fields of JSON that is not an export, not zod's issue dump", async () => {
    const other = file("other.json", '{"version": 1, "authors": [{"name": "123"}], "asks": 5}');
    await expect(run(["statement", other])).rejects.toThrow(
      `${other} is not a CRediT Matrix JSON export. Check authors.0.name, authors.0.firstName, authors.0.middleName and 4 more.`,
    );
    await expect(run(["statement", file("list.json", "[]")])).rejects.toThrow(/Check the top level\.$/);
  });

  it("passes other import errors through unchanged", async () => {
    const newer = file("newer.json", '{"version": 99, "authors": []}');
    await expect(run(["statement", newer])).rejects.toBeInstanceOf(NewerVersionError);
  });
});

describe("credit-matrix standard input", () => {
  it("reads the roster from - when piped in", async () => {
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      Readable.from([
        Buffer.from("Name,Software\nJane "),
        Buffer.from("Smith,100\n"),
      ]) as unknown as typeof process.stdin,
    );
    expect(await run(["statement", "-"])).toBe("CRediT: Software: Jane Smith");
    vi.restoreAllMocks();
  });

  it("calls piped JSON that is not an export the input, having no file name", async () => {
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      Readable.from([Buffer.from("[]")]) as unknown as typeof process.stdin,
    );
    await expect(run(["statement", "-"])).rejects.toThrow(/^The input is not a CRediT Matrix JSON export\./);
    vi.restoreAllMocks();
  });
});

describe("credit-matrix as a program", () => {
  const cliPath = fileURLToPath(new URL("../cli.ts", import.meta.url));
  const originalArgv = process.argv;
  const originalExitCode = process.exitCode;

  async function launch(...args: string[]) {
    process.argv = ["node", cliPath, ...args];
    const out = vi.spyOn(process.stdout, "write").mockReturnValue(true);
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    vi.resetModules();
    await import("../cli");
    await vi.waitUntil(() => out.mock.calls.length + err.mock.calls.length > 0);
    return { out: out.mock.calls.join(""), err: err.mock.calls.join("") };
  }

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    vi.restoreAllMocks();
  });

  it("prints the result with one trailing newline and exits 0", async () => {
    const { out, err } = await launch("statement", csv);
    expect(out).toBe("CRediT: Conceptualization: Jane Smith; Software: Jane Smith, Bob White\n");
    expect(err).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the message and a pointer to --help for a command line mistake, and exits 2", async () => {
    const { out, err } = await launch("convert", csv);
    expect(out).toBe("");
    expect(err).toBe(
      "credit-matrix: convert needs --to json, csv, jats, crossref or md.\nRun 'credit-matrix --help' for usage.\n",
    );
    expect(process.exitCode).toBe(2);
  });

  it("treats an option the parser rejects as a mistake too", async () => {
    const { err } = await launch("statement", csv, "--nope");
    expect(err).toMatch(/^credit-matrix: Unknown option '--nope'.*\nRun 'credit-matrix --help' for usage\.\n$/);
    expect(process.exitCode).toBe(2);
  });

  it("refuses a cut-off XML file, and exits 1", async () => {
    const xml = await run(["convert", csv, "--to", "jats"]);
    const { out, err } = await launch("statement", file("cut.xml", xml.slice(0, xml.indexOf("</contrib>"))));
    expect(out).toBe("");
    expect(err).toMatch(/^credit-matrix: XML parse error/);
    expect(process.exitCode).toBe(1);
  });

  it("prints an invalid JSON export's problem on one line, and exits 1", async () => {
    const { err } = await launch("convert", file("bad.json", '{"version":1,"authors":[{"name":5}]}'), "--to", "csv");
    expect(err).toMatch(
      /^credit-matrix: \S*bad\.json is not a CRediT Matrix JSON export\. Check authors\.0\.\S+.*\.\n$/,
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints only the message for a contributor the file does not have, and exits 1", async () => {
    const { err } = await launch("ask", csv, "--contributor", "Nobody");
    expect(err).toBe("credit-matrix: No contributor named or with id Nobody. Contributors: Jane Smith, Bob White.\n");
    expect(process.exitCode).toBe(1);
  });

  it("prints only the message when the file cannot be read, and exits 1", async () => {
    const { err } = await launch("statement", join(dir, "missing.csv"));
    expect(err).toBe(`credit-matrix: Cannot read ${join(dir, "missing.csv")}: no such file.\n`);
    expect(process.exitCode).toBe(1);
  });
});
