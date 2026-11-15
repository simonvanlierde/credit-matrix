import { readFileSync } from "node:fs";
import fontkit from "@pdf-lib/fontkit";
import { expect, it, vi } from "vitest";
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

it("keeps glyph ids with retainGids and renumbers them without", async () => {
  const subsetter = await createSubsetter(readFileSync(new URL("harfbuzz-subset.wasm", fonts)));
  const bytes = readFileSync(new URL("NotoSans-Regular.ttf", fonts));
  const whole = fontkit.create(bytes);
  const id = whole.glyphForCodePoint(0x41).id;
  const face = subsetter.face(bytes);
  const retained = fontkit.create(face.subset([0x41], true));
  expect(retained.glyphForCodePoint(0x41).id).toBe(id);
  expect(retained.numGlyphs).toBe(id + 1);
  const renumbered = fontkit.create(face.subset([0x41], false));
  // .notdef and A.
  expect(renumbered.numGlyphs).toBe(2);
  expect(renumbered.glyphForCodePoint(0x41).id).toBe(1);
  expect(renumbered.hasGlyphForCodePoint(0x42)).toBe(false);
});

it("says why it cannot subset a face too large for its memory or not a font at all", async () => {
  const subsetter = await createSubsetter(readFileSync(new URL("harfbuzz-subset.wasm", fonts)));
  expect(() => subsetter.face(new Uint8Array(70e6)).subset([0x41], false)).toThrow("A 70 MB font is too large");
  expect(() => subsetter.face(new Uint8Array(64)).subset([0x41], false)).toThrow(/HarfBuzz/);
});

it("frees the subset face and its blob when HarfBuzz returns an empty subset", async () => {
  const wasm = readFileSync(new URL("harfbuzz-subset.wasm", fonts));
  const { instance } = await WebAssembly.instantiate(wasm);
  const real = instance.exports as Record<string, (...args: number[]) => number>;
  const destroyed: string[] = [];
  const exports = {
    ...real,
    hb_blob_get_length: () => 0,
    hb_blob_destroy: (blob: number) => {
      destroyed.push("blob");
      return real.hb_blob_destroy?.(blob);
    },
    hb_face_destroy: (face: number) => {
      destroyed.push("face");
      return real.hb_face_destroy?.(face);
    },
  };
  const instantiate = vi.spyOn(WebAssembly, "instantiate").mockResolvedValue({ instance: { exports } } as never);
  try {
    const face = (await createSubsetter(wasm)).face(readFileSync(new URL("NotoSans-Regular.ttf", fonts)));
    expect(() => face.subset([0x41], false)).toThrow("HarfBuzz returned an empty subset");
    // The source face and blob, and the subset face and the blob it references.
    expect(destroyed.sort()).toEqual(["blob", "blob", "face", "face"]);
  } finally {
    instantiate.mockRestore();
  }
});
