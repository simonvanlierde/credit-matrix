// biome-ignore lint/correctness/noNodejsModules: the custom font is a test fixture on disk.
import { fileURLToPath } from "node:url";
import { DOMParser } from "linkedom";
import { describe, test } from "vitest";
import { MAX_AUTHORS, MAX_IMPORT_BYTES } from "../author";
import { CREDIT_ROLES } from "../credit-roles";
import { lookupDoiWork } from "../doi-lookup";
import { toCrossrefContributors } from "../export/crossref";
import { toCsv } from "../export/csv";
import { heatmapPrintWarning } from "../export/heatmap-print";
import { buildHeatmapSvg } from "../export/heatmap-svg";
import { toJson } from "../export/json";
import { toTenzing } from "../export/tenzing";
import { toJats4rXml } from "../export/xml";
import { createFigureRenderer } from "../figures";
import { generateStatement, STATEMENT_FORMATS, statementSpans } from "../generate-statement";
import { importAny } from "../import";
import { createAuthor } from "../parse-authors";
import { decodeShareHash, encodeShareHash } from "../share-link";
import { MAX_STATEMENT_LENGTH, parseStatement } from "../statement";

// The slowest file each importer accepts. JSON refuses more than MAX_AUTHORS people, so its worst case
// is MAX_AUTHORS long names with every role. The other readers take any number of rows up to
// MAX_IMPORT_BYTES (all of them read only MAX_AUTHORS + 1 of them), so theirs is a file of short rows
// filled to the byte cap. Most of these take over 100 ms here, and CodSpeed's simulated CPU runs about
// 50 times slower, hence the long timeouts.
const TIMEOUT = 300_000;
const linkedom = new DOMParser();
const parser = { parseFromString: (text: string) => linkedom.parseFromString(text, "text/xml") };
const roles = (i: number) => CREDIT_ROLES.map((role, r) => ({ role: role.name, score: 33 * (1 + ((i + r) % 3)) }));
const LONG_NAMES = Array.from({ length: MAX_AUTHORS }, (_, i) =>
  createAuthor(`Given${i} ${"Middle ".repeat(68)}Surname${i}`, {
    orcid: "0000-0002-1825-0097",
    contributions: roles(i),
  }),
);
const SHORT_NAMES = LONG_NAMES.map((_, i) => createAuthor(`Given${i} Surname${i}`, { contributions: roles(i) }));

/** `text` with its first row, from `first` up to `end` (included when `keepEnd`), repeated up to the byte cap. */
function fill(text: string, first: string, end: string, keepEnd = true): string {
  const start = text.indexOf(first);
  const stop = text.indexOf(end, start + 1) + (keepEnd ? end.length : 0);
  const row = text.slice(start, stop);
  const bytes = (part: string) => new TextEncoder().encode(part).length;
  const copies = Math.floor((MAX_IMPORT_BYTES - bytes(text) + bytes(row)) / bytes(row));
  return text.slice(0, start) + row.repeat(copies) + text.slice(stop);
}
const codemetaPerson = JSON.stringify({ "@type": "Person", givenName: "Marie", familyName: "Curie" });

const FILES = {
  JSON: toJson(LONG_NAMES),
  CodeMeta: `{"@context":"https://w3id.org/codemeta/3.0","author":[${Array(Math.floor(MAX_IMPORT_BYTES / (codemetaPerson.length + 1)) - 1).fill(codemetaPerson)}]}`,
  CSV: fill(toCsv(SHORT_NAMES), "\n", "\n", false),
  tenzing: fill(toTenzing(SHORT_NAMES), "\n", "\n", false),
  JATS: fill(toJats4rXml(SHORT_NAMES), "<contrib ", "</contrib>"),
  Crossref: fill(toCrossrefContributors(SHORT_NAMES), "<person_name", "</person_name>"),
  names: "Marie Curie\n".repeat(Math.floor(MAX_IMPORT_BYTES / 12)),
};

// Fixed names keep CodSpeed's history when an exporter's output changes. Sizes: JSON about 830 kB, the
// others within one row of MAX_IMPORT_BYTES.
describe("importers at the size cap", () => {
  for (const [format, text] of Object.entries(FILES)) {
    test(`${format} at the size cap`, { timeout: TIMEOUT }, async ({ bench }) => {
      await bench(format, async () => {
        await importAny(text, { parser });
      }).run();
    });
  }
});

describe(`${MAX_AUTHORS} contributors, every role`, () => {
  test("statements and heatmap", { timeout: TIMEOUT }, async ({ bench }) => {
    await bench.compare(
      ...STATEMENT_FORMATS.map((format) =>
        bench(`${format} text`, () => {
          generateStatement(LONG_NAMES, { format, showLevels: true });
        }),
      ),
      bench("by-author spans", () => {
        statementSpans(LONG_NAMES, { format: "by-author", showLevels: true });
      }),
      bench("heatmap SVG", () => {
        buildHeatmapSvg(LONG_NAMES);
      }),
    );
  });
});

// Inputs that once made a regex backtrack quadratically (superlinear.test.ts guards the shape as well).
describe("former quadratic inputs at their caps", () => {
  const lead = "M.C.: methodology; ";
  const statement = `${lead}${"A".repeat(MAX_STATEMENT_LENGTH - lead.length - 9)} software`;
  const one = toJats4rXml(SHORT_NAMES.slice(0, 1));
  const slashes = one.replace(
    'identifier="https://credit.niso.org/contributor-roles/',
    (url) => url + "/".repeat(MAX_IMPORT_BYTES - one.length - 100),
  );
  test("statement lead-in, JATS role URL, unclosed SVG and text tags", { timeout: TIMEOUT }, async ({ bench }) => {
    await bench.compare(
      bench("statement lead-in", () => {
        parseStatement(statement, [{ given: "Marie", surname: "Curie" }]);
      }),
      bench("JATS role URL of slashes", async () => {
        await importAny(slashes, { parser });
      }),
      bench("unclosed <svg tags", () => {
        try {
          heatmapPrintWarning("<svg ".repeat(MAX_IMPORT_BYTES / 5));
        } catch {
          // No dimensions: only the scan counts.
        }
      }),
      bench("unclosed <text tags", () => {
        try {
          heatmapPrintWarning(`<svg width="1" height="1">${"<text ".repeat(MAX_IMPORT_BYTES / 6)}`);
        } catch {
          // No text sizes: only the scan counts.
        }
      }),
    );
  });
});

// Every other contributor with name parts that differ from the parsed name, so the link carries `p`.
const WITH_PARTS = LONG_NAMES.map((author, i) =>
  i % 2 ? author : { ...author, middleName: "", surname: `Middle Surname${i}` },
);
const SHARE_HASH = await encodeShareHash({ authors: WITH_PARTS });

describe(`share link with ${MAX_AUTHORS} contributors`, () => {
  test("encode and decode", { timeout: TIMEOUT }, async ({ bench }) => {
    // decodeShareHash returns null on any error, which would time the refusal instead.
    if ((await decodeShareHash(SHARE_HASH))?.authors.length !== MAX_AUTHORS) throw new Error("the link did not decode");
    await bench.compare(
      bench("encode", async () => {
        await encodeShareHash({ authors: WITH_PARTS });
      }),
      bench("decode", async () => {
        await decodeShareHash(SHARE_HASH);
      }),
    );
  });
});

// The figure renderer embeds a subset of each face it draws with, where buildHeatmapSvg names a font stack.
describe(`figure SVG with embedded fonts, ${MAX_AUTHORS} contributors`, () => {
  const renderer = createFigureRenderer();
  const custom = {
    font: "Figure Test",
    fontPath: [fileURLToPath(new URL("../__tests__/fixtures/fonts/", import.meta.url))],
    ignoreSystemFonts: true,
  };
  test("Noto Sans and a custom family", { timeout: TIMEOUT }, async ({ bench }) => {
    await bench.compare(
      bench("Noto Sans subset, long names", async () => {
        await renderer.svg(LONG_NAMES);
      }),
      bench("custom family subset", async () => {
        await renderer.svg(SHORT_NAMES, custom);
      }),
    );
  });
});

// A Crossref record with as many authors as a draft holds, served without the network.
const CROSSREF_WORK = JSON.stringify({
  status: "ok",
  message: {
    title: ["A long author list"],
    author: SHORT_NAMES.map((author) => ({
      given: author.firstName,
      family: author.surname,
      ORCID: "https://orcid.org/0000-0002-1825-0097",
    })),
  },
});
const crossref = async () => new Response(CROSSREF_WORK);

describe(`DOI lookup with ${MAX_AUTHORS} authors`, () => {
  test("Crossref record", async ({ bench }) => {
    if (!(await lookupDoiWork("10.5555/12345678", crossref)).ok) throw new Error("the lookup failed");
    await bench("Crossref record", async () => {
      await lookupDoiWork("10.5555/12345678", crossref);
    }).run();
  });
});
