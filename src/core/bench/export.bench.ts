import { describe, test } from "vitest";
import { CREDIT_ROLES } from "../credit-roles";
import { fromCsv, toCsv } from "../export/csv";
import { buildHeatmapSvg } from "../export/heatmap-svg";
import { toJats4rXml } from "../export/xml";
import { generateStatement, statementSpans } from "../generate-statement";
import { createAuthor } from "../parse-authors";

const AUTHORS = Array.from({ length: 200 }, (_, i) =>
  createAuthor(`Given${i} Surname${i}`, {
    contributions: CREDIT_ROLES.map((role, r) => ({ role: role.name, score: ((i + r) % 4) * 33 })),
  }),
);

describe("200 contributors", () => {
  test("statements", async ({ bench }) => {
    await bench.compare(
      bench("plain text", () => {
        generateStatement(AUTHORS, { format: "by-author", showLevels: true });
      }),
      bench("interactive spans", () => {
        statementSpans(AUTHORS, { format: "by-author", showLevels: true });
      }),
    );
  });

  test("exports", async ({ bench }) => {
    await bench.compare(
      bench("CSV round trip", () => {
        fromCsv(toCsv(AUTHORS));
      }),
      bench("JATS4R XML", () => {
        toJats4rXml(AUTHORS);
      }),
      bench("heatmap SVG", () => {
        buildHeatmapSvg(AUTHORS);
      }),
    );
  });
});
