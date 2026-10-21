import { test } from "vitest";
import { fromCsv, toCsv } from "../export/csv";
import { buildHeatmapSvg } from "../export/heatmap-svg";
import { fromJson, toJson } from "../export/json";
import { toMarkdown } from "../export/markdown";
import { fromTenzing } from "../export/tenzing";
import { toJats4rXml } from "../export/xml";
import { fromJats4rXml } from "../export/xml-import";
import { generateStatement, STATEMENT_FORMATS } from "../generate-statement";
import { detectFormat, importAny } from "../import";
import { normalizeRoster, parseAuthorText } from "../parse-authors";
import { fromSharePayload, toSharePayload } from "../share-payload";
import { parseStatement, statementAuthor } from "../statement";
import { validateContributions } from "../validate";
import { names, roster } from "./fixtures";

// A typical paper and a large consortium-style author list.
const SMALL = roster(8);
const LARGE = roster(120);

const NAME_LIST = names(120).join("\n");
const CSV = toCsv(LARGE);
const JSON_EXPORT = toJson(LARGE);
const XML = toJats4rXml(LARGE);
const STATEMENT = generateStatement(SMALL, { format: "by-author" });
const STATEMENT_AUTHORS = SMALL.map(statementAuthor);

const TENZING_HEADER =
  "Author/Acknowledgee,Order in publication,Firstname,Middle name,Surname,Conceptualization,Data curation," +
  "Formal analysis,Funding acquisition,Investigation,Methodology,Project administration,Resources,Software," +
  "Supervision,Validation,Visualization,Writing - original draft,Writing - review & editing,Notes," +
  "Affiliation 1,Affiliation 2,Affiliation 3,Funding,ORCID iD,Email address,Corresponding author?,Declares";
const TENZING = [
  TENZING_HEADER,
  ...LARGE.map((author, i) =>
    [
      author.contributorType === "author" ? "Author" : "Acknowledgee",
      String(i + 1),
      author.firstName,
      author.middleName,
      author.surname,
      ...author.contributions.map((c) => (c.score > 0 ? "TRUE" : "FALSE")),
      "",
      "Leiden University",
      "",
      "",
      "",
      author.orcid ?? "",
      "",
      author.corresponding ? "TRUE" : "FALSE",
      "",
    ].join(","),
  ),
].join("\n");

const SHARE_PAYLOAD = toSharePayload({ authors: LARGE, title: "A consortium paper" });

// One test per area: `bench.compare` runs its benchmarks side by side, and CodSpeed
// reports each one as `<file>::<test>::<benchmark>`.

test("parse authors", async ({ bench }) => {
  await bench.compare(
    bench("parseAuthorText (120 names)", () => {
      parseAuthorText(NAME_LIST);
    }),
    bench("normalizeRoster (120 authors)", () => {
      normalizeRoster(LARGE);
    }),
    bench("validateContributions (120 authors)", () => {
      validateContributions(LARGE);
    }),
  );
});

test("statement", async ({ bench }) => {
  await bench.compare(
    ...STATEMENT_FORMATS.map((format) =>
      bench(`generateStatement ${format} (120 authors)`, () => {
        generateStatement(LARGE, { format, showLevels: true });
      }),
    ),
    bench("parseStatement (8 authors)", () => {
      parseStatement(STATEMENT, STATEMENT_AUTHORS);
    }),
  );
});

test("export", async ({ bench }) => {
  await bench.compare(
    bench("toCsv (120 authors)", () => {
      toCsv(LARGE);
    }),
    bench("toJson (120 authors)", () => {
      toJson(LARGE);
    }),
    bench("toJats4rXml (120 authors)", () => {
      toJats4rXml(LARGE);
    }),
    bench("toMarkdown (120 authors)", () => {
      toMarkdown(LARGE);
    }),
    bench("buildHeatmapSvg (8 authors)", () => {
      buildHeatmapSvg(SMALL);
    }),
    bench("buildHeatmapSvg transposed (120 authors)", () => {
      buildHeatmapSvg(LARGE, { transpose: true, acronyms: false });
    }),
  );
});

test("import", async ({ bench }) => {
  await bench.compare(
    bench("fromCsv (120 authors)", () => {
      fromCsv(CSV);
    }),
    bench("fromJson (120 authors)", () => {
      fromJson(JSON_EXPORT);
    }),
    bench("fromJats4rXml (120 authors)", () => {
      fromJats4rXml(XML);
    }),
    bench("fromTenzing (120 authors)", () => {
      fromTenzing(TENZING);
    }),
    bench("detectFormat (six formats)", () => {
      detectFormat(CSV);
      detectFormat(JSON_EXPORT);
      detectFormat(XML);
      detectFormat(TENZING);
      detectFormat(STATEMENT);
      detectFormat(NAME_LIST);
    }),
    bench("importAny csv (120 authors)", async () => {
      await importAny(CSV);
    }),
  );
});

// The payload a share link carries, without the deflate step: CompressionStream runs
// off the main thread, which the CPU simulation cannot measure reliably.
test("share payload", async ({ bench }) => {
  await bench.compare(
    bench("toSharePayload (120 authors)", () => {
      toSharePayload({ authors: LARGE, title: "A consortium paper" });
    }),
    bench("fromSharePayload (120 authors)", () => {
      fromSharePayload(SHARE_PAYLOAD);
    }),
  );
});
