import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createSubsetter } from "../subset";

const fonts = new URL("../../fonts/", import.meta.url);
const LARGE = [
  "CreditFigureJP.ttf",
  "CreditFigureKR.ttf",
  "CreditFigureSC.ttf",
  "CreditFigureSerifJP.ttf",
  "CreditFigureSerifSC.ttf",
];

it("keeps no face in its fixed 64 MB memory between subsets", async () => {
  const subsetter = await createSubsetter(readFileSync(new URL("harfbuzz-subset.wasm", fonts)));
  const bytes = LARGE.map((file) => readFileSync(new URL(file, fonts)));
  // 46 MB a round: faces kept in memory would run out in the second.
  for (let round = 0; round < 3; round++)
    for (const face of bytes) expect(subsetter.face(face).subset([0x41, 0x4e2d], false).length).toBeGreaterThan(0);
});
