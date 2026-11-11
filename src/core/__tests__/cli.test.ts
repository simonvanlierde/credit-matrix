// biome-ignore-all lint/correctness/noNodejsModules: the CLI reads files, so its tests write some.
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assertBalancedTags, run as runCommand, USAGE } from "../cli";
import { heatmapPrintWarning } from "../export/heatmap-print";
import { NewerVersionError, toJson } from "../export/json";
import { createFigureRenderer } from "../figures";
import { createAuthor } from "../parse-authors";
import { decodeShareHash } from "../share-link";

const dir = mkdtempSync(join(tmpdir(), "credit-matrix-cli-"));

function file(name: string, text: string): string {
  const path = join(dir, name);
  writeFileSync(path, text);
  return path;
}

async function run(argv: string[]): Promise<string> {
  const output = await runCommand(argv);
  if (typeof output !== "string") throw new Error("Expected textual CLI output");
  return output;
}

const csv = file("team.csv", "Name,Conceptualization,Software\nGrace Hopper,100,66\nCharles Darwin,,100\n");

it("exports a binary PDF with embedded figure fonts", async () => {
  const bytes = await runCommand(["convert", csv, "--to", "pdf"]);
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(new TextDecoder().decode((bytes as Uint8Array).slice(0, 8))).toBe("%PDF-1.7");
  const svg = await run(["convert", csv, "--to", "svg"]);
  expect(svg).toContain("@font-face");
  expect(svg).toContain("<text");
});

it("warns on stderr when a heatmap would print too small on a full page, and only then", async () => {
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const rows = Array.from({ length: 40 }, (_, i) => `Grace Hopper ${i},100,`).join("\n");
  const large = file("large.csv", `Name,Conceptualization,Software\n${rows}\n`);
  const svg = await run(["convert", large, "--to", "svg"]);
  await runCommand(["convert", large, "--to", "pdf"]);
  const warnings = stderr.mock.calls.flat().filter((text) => String(text).includes("smallest labels"));
  // The warning measures the figure the CLI writes, not an estimate of it.
  expect(warnings).toEqual(Array(2).fill(`credit-matrix: ${heatmapPrintWarning(svg)}\n`));
  stderr.mockClear();
  await run(["convert", csv, "--to", "svg"]);
  expect(stderr.mock.calls.flat().join(" ")).not.toContain("smallest labels");
  stderr.mockRestore();
});

it("names the characters the figure fonts cannot draw, in one line", async () => {
  const source = file("unsupported-script.csv", "Name,Software\nབོད,100\n");
  for (const to of ["svg", "pdf"])
    await expect(runCommand(["convert", source, "--to", to])).rejects.toThrow(
      /^The figure fonts cannot draw བ \(U\+0F56\)[^\n]*\. [^\n]+$/u,
    );
});

it("exports manuscript YAML with levels only where the schema supports them", async () => {
  const quarto = await run(["convert", csv, "--to", "quarto"]);
  expect(quarto).toContain("author:\n");
  expect(quarto).toContain('"Software": equal');
  expect(await run(["convert", csv, "--to", "quarto", "--yes-no"])).not.toContain(": equal");
  const myst = await run(["convert", csv, "--to", "myst"]);
  expect(myst).toContain("authors:\n");
  expect(myst).toContain("MyST omits contribution levels");
  expect(myst).not.toContain(": equal");
});

describe("credit-matrix statement", () => {
  it("prints an RO-Crate attribution fragment and its limits", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const metadata = JSON.parse(await run(["convert", csv, "--to", "ro-crate"]));
    expect(metadata["@context"]).toBe("https://w3id.org/ro/crate/1.2/context");
    expect(metadata["@graph"][0]["@id"]).toBe("./");
    expect(stderr.mock.calls.flat().join(" ")).toContain("not a standalone RO-Crate");
  });
  it("prints the by-role statement by default", async () => {
    expect(await run(["statement", csv])).toBe(
      "CRediT: Conceptualization: Grace Hopper; Software: Grace Hopper, Charles Darwin",
    );
  });

  it("takes a format and a locale", async () => {
    expect(await run(["statement", csv, "--format", "by-author"])).toBe(
      "CRediT: Grace Hopper: Conceptualization, Software; Charles Darwin: Software",
    );
    expect(await run(["statement", csv, "--locale", "fr"])).toContain("Conceptualisation\u00a0: Grace Hopper");
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
    // Traditional Chinese has no catalog: English, not Simplified.
    const english = await run(["statement", csv, "--locale", "en"]);
    expect(await run(["statement", csv, "--locale", "zh-TW"])).toBe(english);
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
    const levels = file("levels.csv", "Name,Software\nGrace Hopper,50\nCharles Darwin,100\n");
    expect(await run(["statement", levels, "--levels"])).toBe("CRediT: Software: Grace Hopper (Equal), Charles Darwin");
  });

  it("prints linked CodeMeta people and roles, with explicit identity and score losses", async () => {
    const fixture = (name: string) => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
    const err = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    const output = await run(["statement", fixture("export-codemeta.json"), "--format", "codemeta"]);
    expect(JSON.parse(output)).toEqual(JSON.parse(readFileSync(fixture("export-codemeta.expected.json"), "utf8")));
    expect(err.mock.calls.join("")).toBe(
      "credit-matrix: Antonie van Leeuwenhoek has no ORCID iD; their link identifies them only within this document.\n" +
        "credit-matrix: Katherine Johnson has no ORCID iD; their link identifies them only within this document.\n" +
        "credit-matrix: CodeMeta omits scores and contribution levels; keep the original roster JSON.\n",
    );
    vi.restoreAllMocks();
  });

  it.each(["Carberry Josiah Carberry", "CarberryJosiah Carberry", "Josiah Carberry Carberry"])(
    "keeps structured given names in CodeMeta, JATS and Crossref: %s",
    async (name) => {
      const author = createAuthor(name, {
        firstName: "Josiah",
        middleName: "Carberry",
        surname: "Carberry",
        contributions: [{ role: "Software", score: 100 }],
      });
      const input = file("structured-names.json", toJson([author]));
      vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const codemeta = JSON.parse(await run(["statement", input, "--format", "codemeta"]));
      expect(codemeta.author[0]).toMatchObject({ givenName: "Josiah Carberry", familyName: "Carberry" });
      expect(await run(["convert", input, "--to", "jats"])).toContain("<given-names>Josiah Carberry</given-names>");
      expect(await run(["convert", input, "--to", "crossref"])).toContain("<given_name>Josiah Carberry</given_name>");
    },
  );

  it("refuses a roster with no roles rather than print an empty statement", async () => {
    const names = file("names.txt", "Grace Hopper, Charles Darwin");
    await expect(run(["statement", names])).rejects.toThrow("No roles assigned yet: the statement is empty.");
    await expect(run(["statement", names, "--format", "codemeta"])).rejects.toThrow(
      "No roles assigned yet: the statement is empty.",
    );
  });

  it("refuses a spreadsheet or other binary file instead of reading it as names", async () => {
    const message = "Excel and other spreadsheet files are not read: save the sheet as CSV first.";
    await expect(run(["statement", file("team.xlsx", "Grace Hopper")])).rejects.toThrow(message);
    await expect(run(["statement", file("team.bin", "PK\x03\x04Grace Hopper")])).rejects.toThrow(message);
    await expect(run(["statement", file("team.dat", "Grace\0Hopper")])).rejects.toThrow(message);
  });

  it("reads a UTF-16 file, as Excel's Unicode Text export writes, instead of refusing it", async () => {
    const text = "Name,Conceptualization\nGrace Hopper,100\n";
    const le = join(dir, "utf16le.csv");
    writeFileSync(le, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]));
    expect(await run(["statement", le])).toBe("CRediT: Conceptualization: Grace Hopper");
    const be = join(dir, "utf16be.csv");
    writeFileSync(be, Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(text, "utf16le").swap16()]));
    expect(await run(["statement", be])).toBe("CRediT: Conceptualization: Grace Hopper");
  });
});

describe("credit-matrix convert", () => {
  it("refuses a latex-credits export with no roles, which the package cannot compile", async () => {
    const names = file("names.txt", "Grace Hopper, Charles Darwin");
    await expect(run(["convert", names, "--to", "latex-credits"])).rejects.toThrow(
      "No roles assigned yet: the latex-credits export is empty.",
    );
  });

  it("writes latex-credits values as 1 or 0 with --yes-no", async () => {
    const team = file("half.csv", "Name,Software\nGrace Hopper,50\n");
    expect(await run(["convert", team, "--to", "latex-credits", "--yes-no"])).toContain(
      "\\credit{Grace Hopper}{0,0,0,0,0,0,0,0,1,0,0,0,0,0}",
    );
  });

  it("tells a .cff input to convert to codemeta.json first", async () => {
    const cff = file("CITATION.cff", "cff-version: 1.2.0\ntitle: Example\nauthors:\n  - name: Ana Lima\n");
    await expect(run(["convert", cff, "--to", "csv"])).rejects.toThrow(/convert the file to codemeta\.json first/);
  });

  it("writes each format, and reads its own JATS back without a browser", async () => {
    expect(await run(["convert", csv, "--to", "csv"])).toMatch(/^Name,ORCID/);
    expect(JSON.parse(await run(["convert", csv, "--to", "json"])).authors).toHaveLength(2);
    expect(await run(["convert", csv, "--to", "md"])).toContain("| Grace Hopper |");
    expect(await run(["convert", csv, "--to", "latex-credits"])).toContain("\\credit{Grace Hopper}{");
    expect(await run(["convert", csv, "--to", "crossref"])).toContain('<role vocab="credit" type="software"/>');
    const xml = file("team.xml", await run(["convert", csv, "--to", "jats"]));
    expect(await run(["statement", xml])).toBe(await run(["statement", csv]));
  });

  it("writes JATS without degree-contribution with --yes-no, and reads it back", async () => {
    const ticks = file("ticks.csv", "Name,Conceptualization,Software\nGrace Hopper,100,100\nCharles Darwin,,100\n");
    const xml = await run(["convert", ticks, "--to", "jats", "--yes-no"]);
    expect(xml).not.toContain("degree-contribution");
    expect(await run(["convert", ticks, "--to", "jats"])).toContain('degree-contribution="lead"');
    // A role with no level imports as contributed, so the statement survives the round trip.
    expect(await run(["statement", file("ticks.xml", xml)])).toBe(await run(["statement", ticks]));
  });

  it("writes Tenzing and the heatmap SVG", async () => {
    const tenzing = await run(["convert", csv, "--to", "tenzing"]);
    expect(tenzing).toMatch(/^Author\/Acknowledgee,/);
    expect(tenzing).toContain("Author,1,Grace,,Hopper,");
    const svg = await run(["convert", csv, "--to", "svg"]);
    expect(svg).toMatch(/^<svg /);
    expect(svg).toContain("Grace Hopper");
    expect(await run(["convert", csv, "--to", "svg", "--locale", "fr"])).toContain("Logiciel");
    const flat = await run(["convert", csv, "--to", "svg", "--yes-no"]);
    expect(flat).toContain("Contributed");
    expect(flat).not.toContain("Equal");
    expect(flat).not.toContain("Supporting");
  });

  it("writes Markdown in the --locale language", async () => {
    const md = await run(["convert", csv, "--to", "md", "--locale", "fr"]);
    expect(md).toContain("| Grace Hopper | Conceptualisation");
    expect(md).toContain("Logiciel(s)");
    await expect(run(["convert", csv, "--to", "md", "--locale", "xx"])).rejects.toThrow("Unknown locale: xx.");
  });

  it("needs --to", async () => {
    await expect(run(["convert", csv])).rejects.toThrow(
      /--to json, csv, jats, crossref, md, latex-credits, tenzing, svg, pdf, quarto, myst or ro-crate/,
    );
  });
});

describe("credit-matrix ask", () => {
  const jane = createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] });
  const json = file("draft.json", toJson([jane, createAuthor("Charles Darwin")]));

  it("prints a link for one contributor, by name or id", async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const link = await run(["ask", json, "--contributor", "grace hopper"]);
    expect(link).toMatch(/^https:\/\/credit\.duinlab\.nl\/#s=/);
    const shared = await decodeShareHash(link.slice(link.indexOf("#")));
    expect(shared).toMatchObject({ claimId: jane.id, blank: false, sentAt: 1_700_000_000_000 });
    expect(shared?.authors.map((a) => a.name)).toEqual(["Grace Hopper"]);
    expect(await run(["ask", json, "--contributor", jane.id])).toContain("#s=");
  });

  it("sends a blank row to another base URL", async () => {
    const link = await run([
      "ask",
      json,
      "--contributor",
      "Grace Hopper",
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
    const link = await run(["ask", json, "--contributor", "HOPPER"]);
    expect((await decodeShareHash(link.slice(link.indexOf("#"))))?.claimId).toBe(jane.id);
    expect(await run(["ask", json, "--contributor", "charles"])).toContain("#s=");
  });

  it("finds a contributor whose name is typed decomposed", async () => {
    const jose = createAuthor("Jos\u00E9 Garc\u00EDa");
    const accents = file("accents.json", toJson([jose, createAuthor("Charles Darwin")]));
    const link = await run(["ask", accents, "--contributor", "Jose\u0301 Garci\u0301a"]);
    expect((await decodeShareHash(link.slice(link.indexOf("#"))))?.claimId).toBe(jose.id);
  });

  it("lists the contributors when none or several match", async () => {
    const twins = file("twins.json", toJson([createAuthor("Grace Hopper"), createAuthor("Grace Chisholm Young")]));
    await expect(run(["ask", twins, "--contributor", "grace"])).rejects.toThrow(
      "grace matches more than one contributor: Grace Hopper, Grace Chisholm Young. Give the full name or id.",
    );
    await expect(run(["ask", json, "--contributor", "Nobody"])).rejects.toThrow(
      "No contributor named or with id Nobody. Contributors: Grace Hopper, Charles Darwin.",
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

  it("says plainly that a file repeats a contributor id", async () => {
    const jane = createAuthor("Grace Hopper");
    const twice = file("twice.json", JSON.stringify({ version: 1, authors: [jane, jane] }));
    await expect(run(["statement", twice])).rejects.toThrow(`${twice} repeats a contributor id.`);
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
        Buffer.from("Name,Software\nGrace "),
        Buffer.from("Hopper,100\n"),
      ]) as unknown as typeof process.stdin,
    );
    expect(await run(["statement", "-"])).toBe("CRediT: Software: Grace Hopper");
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
    expect(out).toBe("CRediT: Conceptualization: Grace Hopper; Software: Grace Hopper, Charles Darwin\n");
    expect(err).toBe("");
    expect(process.exitCode).toBeUndefined();
  });

  it("prints the message and a pointer to --help for a command line mistake, and exits 2", async () => {
    const { out, err } = await launch("convert", csv);
    expect(out).toBe("");
    expect(err).toBe(
      "credit-matrix: convert needs --to json, csv, jats, crossref, md, latex-credits, tenzing, svg, pdf, quarto, myst or ro-crate.\nRun 'credit-matrix --help' for usage.\n",
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

  it("prints that a file repeats a contributor id, and exits 1", async () => {
    const jane = createAuthor("Grace Hopper");
    const { err } = await launch(
      "statement",
      file("twice2.json", JSON.stringify({ version: 1, authors: [jane, jane] })),
    );
    expect(err).toMatch(/^credit-matrix: \S*twice2\.json repeats a contributor id\.\n$/);
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
    expect(err).toBe(
      "credit-matrix: No contributor named or with id Nobody. Contributors: Grace Hopper, Charles Darwin.\n",
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints only the message when the file cannot be read, and exits 1", async () => {
    const { err } = await launch("statement", join(dir, "missing.csv"));
    expect(err).toBe(`credit-matrix: Cannot read ${join(dir, "missing.csv")}: no such file.\n`);
    expect(process.exitCode).toBe(1);
  });
});

it("passes figure options through the SVG conversion", async () => {
  const svg = await run([
    "convert",
    csv,
    "--to",
    "svg",
    "--shape",
    "circle",
    "--size",
    "30",
    "--font",
    "serif",
    "--font-size",
    "21",
    "--palette",
    "green",
    "--legend",
    "false",
    "--horizontal",
    "--labels",
    "short",
    "--skipempty",
    "false",
  ]);
  expect(svg).toContain('width="30" height="30" rx="15"');
  expect(svg).toContain(">1 Conceptualiz…<");
  expect(svg).toContain('font-size="21"');
  expect(svg).toContain("Noto Serif");
  expect(svg).not.toContain(">Supporting<");
  await expect(run(["convert", csv, "--to", "svg", "--legend", "maybe"])).rejects.toThrow("true or false");
  await expect(run(["convert", csv, "--to", "svg", "--font-size", "NaN"])).rejects.toThrow("between 6 and 32");
  await expect(
    run(["convert", csv, "--to", "svg", "--font", "arbitrary", "--font-path", dir, "--ignore-system-fonts"]),
  ).rejects.toThrow(`Cannot find the font family arbitrary in the font path (${dir}), with system fonts ignored.`);
});

it("draws a figure in a font family from --font-path and names its file on standard error", async () => {
  const fonts = fileURLToPath(new URL("fixtures/fonts/", import.meta.url));
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  const figure = [
    "convert",
    csv,
    "--initials",
    "false",
    "--font",
    "Figure Test",
    "--font-path",
    dir,
    "--font-path",
    fonts,
  ];
  const svg = await run([...figure, "--ignore-system-fonts", "--to", "svg"]);
  expect(svg).toContain("font-family:'Figure Test'");
  expect(svg).toContain('<tspan font-family="Figure Test">Grace Hopper</tspan>');
  expect(stderr.mock.calls.flat().join("")).toBe(
    `credit-matrix: font: Figure Test from ${join(fonts, "FigureTest-Regular.ttf")}\n`,
  );
  stderr.mockClear();
  const accented = file("accented.csv", "Name,Software\nZoë Smith,100\n");
  const serif = await run([
    "convert",
    accented,
    ...figure.slice(2),
    "--ignore-system-fonts",
    "--font-fallback",
    "serif",
    "--to",
    "svg",
  ]);
  expect(serif).toContain("font-family:'Noto Serif'");
  await expect(run([...figure, "--font-fallback", "mono", "--to", "svg"])).rejects.toThrow(
    "--font-fallback must be sans or serif.",
  );
  const pdf = await runCommand([...figure, "--ignore-system-fonts", "--to", "pdf"]);
  expect(new TextDecoder().decode((pdf as Uint8Array).slice(0, 8))).toBe("%PDF-1.7");
});

it("selects full names or initials without shortening the text alternative", async () => {
  const full = await run(["convert", csv, "--to", "svg", "--initials", "false"]);
  const compact = await run(["convert", csv, "--to", "svg", "--initials", "true"]);
  expect(full).toContain(">Grace Hopper</tspan>");
  expect(compact).toContain(">GH</tspan>");
  expect(compact).toContain("Grace Hopper: Conceptualization");
  await expect(run(["convert", csv, "--to", "svg", "--initials", "maybe"])).rejects.toThrow("true or false");
});

describe("figure legend options", () => {
  const authors = [createAuthor("Hua Luogeng", { contributions: [{ role: "Software", score: 33 }] })];
  const source = file("legend-options.json", toJson(authors));

  it.each([
    ["auto", true],
    ["auto", false],
    ["right", true],
    ["right", false],
    ["bottom", true],
    ["bottom", false],
  ] as const)("forwards legend placement %s with marks=%s", async (legendPosition, marks) => {
    const svg = await run([
      "convert",
      source,
      "--to",
      "svg",
      "--legend-position",
      legendPosition,
      "--marks",
      String(marks),
    ]);
    expect(svg).toBe(await createFigureRenderer().svg(authors, { locale: "en", legendPosition, marks }));
    expect(svg.includes('aria-hidden="true"')).toBe(marks);
  });

  it("keeps publication defaults and validates legend flags", async () => {
    const defaults = await run(["convert", source, "--to", "svg"]);
    expect(defaults).toBe(
      await createFigureRenderer().svg(authors, { locale: "en", legendPosition: "auto", marks: false }),
    );
    expect(defaults).not.toContain('aria-hidden="true"');
    const hidden = await run(["convert", source, "--to", "svg", "--legend", "false", "--legend-position", "right"]);
    expect(hidden).not.toContain(">Supporting</tspan>");
    await expect(run(["convert", source, "--to", "svg", "--marks", "maybe"])).rejects.toThrow(
      "--marks must be true or false",
    );
    await expect(run(["convert", source, "--to", "svg", "--legend-position", "left"])).rejects.toThrow(
      "--legend-position must be auto, right or bottom",
    );
  });
});

describe("the XML tag-balance check", () => {
  it.each([
    "<a><b/></a>",
    "<a x=\"1 > 0\" y='<'><!-- <b> --><![CDATA[<c>]]><?pi <d>?></a>",
    '<!DOCTYPE article><?xml version="1.0"?><a>text</a>',
  ])("accepts balanced XML: %s", (xml) => {
    expect(() => assertBalancedTags(xml)).not.toThrow();
  });

  it.each([
    ["<a><b></a></b>", "unexpected </a>"],
    ["<a><b/>", "<a> is never closed"],
    ["<a><b", "a tag is cut off"],
    ['<a x="1>', "a tag is cut off"],
    ["<a><!-- open", "a tag is cut off"],
    ["<a>1 < 2</a>", "a tag is cut off"],
    ["<a <b/>", "a tag is cut off"],
    ["<a>".repeat(257), "elements nest too deep"],
  ])("refuses %s", (xml, message) => {
    expect(() => assertBalancedTags(xml)).toThrow(message);
  });

  // Sized so the old regex takes 10 to 15 s on each and the scanner a few ms. A wall-clock bound, not
  // vitest's timeout: synchronous code finishes before a timeout can fire.
  it.each([
    `<${"<a".repeat(2_500)}`,
    "<!DOCTYPE".repeat(50_000),
    "<!--".repeat(80_000),
    `<a ${'x="1" '.repeat(100_000)}`,
  ])("refuses a hostile file in linear time (%#)", (xml) => {
    const start = performance.now();
    expect(() => assertBalancedTags(xml)).toThrow("a tag is cut off");
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("refuses deep nesting before linkedom reads it", () => {
    const start = performance.now();
    expect(() => assertBalancedTags(`${"<a>".repeat(285_000)}${"</a>".repeat(285_000)}`)).toThrow(
      "elements nest too deep",
    );
    expect(performance.now() - start).toBeLessThan(500);
  });
});
