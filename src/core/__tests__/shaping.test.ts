// biome-ignore-all lint/correctness/noNodejsModules: this test reads the shaping engine and fonts from disk.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createShaper } from "../shaping";

const fonts = new URL("../../fonts/", import.meta.url);
const read = async (file: string) => new Uint8Array(await readFile(new URL(file, fonts)));
const glyphs = async (file: string, text: string, rtl = false) => {
  const shaper = await createShaper(await read("harfbuzz.wasm"));
  return shaper
    .face(await read(file))
    .shape(text, rtl)
    .map((glyph) => [glyph.id, glyph.xAdvance, glyph.xOffset, glyph.yOffset]);
};

// Expected values from harfbuzzjs 1.6.4's own API on the same faces, with the same features off.
describe("createShaper", () => {
  it("joins Arabic letters right to left", async () => {
    expect(await glyphs("NotoSansArabic-Regular.ttf", "محمد", true)).toEqual([
      [29, 532, 0, 0],
      [78, 578, 0, 0],
      [26, 637, 0, 0],
      [79, 525, 0, 0],
    ]);
  });

  it("stacks Thai marks, which fontkit gets wrong", async () => {
    expect(await glyphs("NotoSansThai-Regular.ttf", "น้ำ")).toEqual([
      [71, 613, 0, 0],
      [59, 0, 0, 0],
      [49, 0, -29, 0],
      [86, 406, 0, 0],
    ]);
  });

  it("reorders and attaches Bengali marks", async () => {
    expect(await glyphs("NotoSansBengali-Regular.ttf", "রবীন্দ্রনাথ")).toEqual([
      [51, 596, 0, 0],
      [47, 596, 0, 0],
      [61, 266, 0, 0],
      [349, 304, 0, 0],
      [224, 563, 0, 0],
      [324, 0, -837, 0],
      [288, 0, -635, -30],
      [44, 602, 0, 0],
      [59, 266, 0, 0],
      [41, 645, 0, 0],
    ]);
  });
});
