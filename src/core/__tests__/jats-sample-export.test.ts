// biome-ignore lint/correctness/noNodejsModules: tests run in Node; this writes the export for xmllint
import { writeFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: tests run in Node
import process from "node:process";
import { it } from "vitest";
import { toJats4rXml } from "../export/xml";
import { createAuthor } from "../parse-authors";

// Not a real test: scripts/validate-jats.sh sets JATS_OUT to get a fresh
// export on disk for xmllint, and the run is skipped otherwise.
it.runIf(process.env.JATS_OUT)("writes a fresh export for DTD validation", () => {
  const xml = toJats4rXml([
    createAuthor("Jane A. Smith", {
      orcid: "0000-0002-1825-0097",
      corresponding: true,
      equalContribution: true,
      contributions: [
        { role: "Conceptualization", score: 100 },
        { role: "Writing – review & editing", score: 33 },
      ],
    }),
    createAuthor("Bob White", {
      contributorType: "non-author",
      contributions: [{ role: "Investigation", score: 66 }],
    }),
  ]);
  writeFileSync(process.env.JATS_OUT as string, xml);
});
