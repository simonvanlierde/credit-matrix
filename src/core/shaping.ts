import createHarfBuzz from "./vendor/harfbuzz.js";

/** One shaped glyph, in font units, in visual (left to right) order. */
export interface ShapedGlyph {
  /** Glyph id in the face, which a PDF draws with Identity-H. */
  id: number;
  /** UTF-16 index of the first character this glyph came from. */
  cluster: number;
  xAdvance: number;
  yAdvance: number;
  xOffset: number;
  yOffset: number;
}

export interface ShapedFace {
  shape(text: string, rtl: boolean): ShapedGlyph[];
}

export interface Shaper {
  face(bytes: Uint8Array): ShapedFace;
}

const tag = (name: string) => [...name].reduce((value, char) => value * 256 + char.charCodeAt(0), 0);
// Kerning and optional ligatures stay off, as for the other faces and in the SVG's CSS.
const OFF = ["kern", "liga", "clig", "calt"];
const LTR = 4;
const RTL = 5;

/** HarfBuzz from its WebAssembly bytes, which come through the font provider like a face. */
export async function createShaper(wasm: Uint8Array): Promise<Shaper> {
  const module = await createHarfBuzz({ wasmBinary: wasm });
  const hb = module.wasmExports as Record<
    | "malloc"
    | "free"
    | "hb_blob_create"
    | "hb_buffer_add_utf16"
    | "hb_buffer_create"
    | "hb_buffer_destroy"
    | "hb_buffer_get_glyph_infos"
    | "hb_buffer_get_glyph_positions"
    | "hb_buffer_get_length"
    | "hb_buffer_guess_segment_properties"
    | "hb_buffer_set_direction"
    | "hb_face_create"
    | "hb_font_create"
    | "hb_shape",
    (...args: number[]) => number
  >;
  // hb_feature_t: tag, value, start, end; value 0 turns the feature off for the whole buffer.
  const features = hb.malloc(OFF.length * 16);
  for (const [index, name] of OFF.entries())
    module.HEAPU32.set([tag(name), 0, 0, 0xffffffff], features / 4 + index * 4);
  return {
    face(bytes) {
      // shortcut: faces are never freed; a renderer loads each at most once per process.
      const data = hb.malloc(bytes.length);
      module.HEAPU8.set(bytes, data);
      const blob = hb.hb_blob_create(data, bytes.length, 1, 0, 0);
      const font = hb.hb_font_create(hb.hb_face_create(blob, 0));
      return {
        shape(text, rtl) {
          const buffer = hb.hb_buffer_create();
          const units = hb.malloc(text.length * 2);
          for (let index = 0; index < text.length; index++) module.HEAPU16[units / 2 + index] = text.charCodeAt(index);
          hb.hb_buffer_add_utf16(buffer, units, text.length, 0, text.length);
          hb.free(units);
          hb.hb_buffer_set_direction(buffer, rtl ? RTL : LTR);
          hb.hb_buffer_guess_segment_properties(buffer);
          hb.hb_shape(font, buffer, features, OFF.length);
          const length = hb.hb_buffer_get_length(buffer);
          const infos = hb.hb_buffer_get_glyph_infos(buffer, 0) / 4;
          const positions = hb.hb_buffer_get_glyph_positions(buffer, 0) / 4;
          const glyphs: ShapedGlyph[] = [];
          for (let index = 0; index < length; index++) {
            const position = positions + index * 5;
            glyphs.push({
              id: module.HEAPU32[infos + index * 5] ?? 0,
              cluster: module.HEAPU32[infos + index * 5 + 2] ?? 0,
              xAdvance: module.HEAP32[position] ?? 0,
              yAdvance: module.HEAP32[position + 1] ?? 0,
              xOffset: module.HEAP32[position + 2] ?? 0,
              yOffset: module.HEAP32[position + 3] ?? 0,
            });
          }
          hb.hb_buffer_destroy(buffer);
          return glyphs;
        },
      };
    },
  };
}
