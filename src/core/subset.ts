export interface SubsetFace {
  /**
   * A standalone font with these code points' glyphs and the layout tables that reach them, at the default
   * instance of a variable font, unless axes are pinned explicitly. Undefined code points keep every glyph. With `retainGids`, every glyph keeps its id, so ids from the whole face stay valid.
   */
  subset(codePoints: Iterable<number> | undefined, retainGids: boolean, axes?: Record<string, number>): Uint8Array;
}

export interface Subsetter {
  face(bytes: Uint8Array): SubsetFace;
}

// hb-subset.h: HB_SUBSET_FLAGS_RETAIN_GIDS.
const RETAIN_GIDS = 0x2;
// hb_memory_mode_t: HB_MEMORY_MODE_READONLY, so the face reads the bytes in place.
const READONLY = 1;

/**
 * HarfBuzz's subsetter from harfbuzzjs's `harfbuzz-subset.wasm`, which comes through the font provider like a
 * face. The module imports nothing, so it needs no Emscripten loader: its raw exports are called directly.
 */
export async function createSubsetter(wasm: Uint8Array): Promise<Subsetter> {
  // Through globalThis: the CLI's type check has no DOM library, which declares WebAssembly.
  const { WebAssembly: runtime } = globalThis as unknown as {
    WebAssembly: { instantiate(bytes: Uint8Array): Promise<{ instance: { exports: unknown } }> };
  };
  const { instance } = await runtime.instantiate(wasm);
  // Named, so a wasm build that lacks one fails at its call rather than quietly returning nothing.
  const hb = instance.exports as Record<
    | "malloc"
    | "free"
    | "hb_blob_create"
    | "hb_blob_destroy"
    | "hb_blob_get_data"
    | "hb_blob_get_length"
    | "hb_face_create"
    | "hb_face_destroy"
    | "hb_face_reference_blob"
    | "hb_set_add"
    | "hb_set_invert"
    | "hb_subset_input_glyph_set"
    | "hb_subset_input_pin_axis_location"
    | "hb_subset_input_create_or_fail"
    | "hb_subset_input_destroy"
    | "hb_subset_input_pin_all_axes_to_default"
    | "hb_subset_input_set_flags"
    | "hb_subset_input_unicode_set"
    | "hb_subset_or_fail",
    (...args: number[]) => number
  > & { _initialize?: () => void; memory: { buffer: ArrayBuffer } };
  hb._initialize?.();
  // A view of memory as it is now: any call can grow it and detach an older view.
  const heap = () => new Uint8Array(hb.memory.buffer);
  return {
    face(bytes) {
      return {
        subset(codePoints, retainGids, axes) {
          // The module's memory is fixed at 64 MB, so each subset copies its face in and frees it again
          // (about 10 ms for a 14 MB face) rather than keeping every face a long-lived renderer has seen.
          const data = hb.malloc(bytes.length);
          if (!data)
            throw new Error(`A ${Math.round(bytes.length / 1e6)} MB font is too large for HarfBuzz's subsetter.`);
          heap().set(bytes, data);
          const source = hb.hb_blob_create(data, bytes.length, READONLY, 0, 0);
          const face = hb.hb_face_create(source, 0);
          const input = hb.hb_subset_input_create_or_fail();
          let result = 0;
          let blob = 0;
          try {
            if (!input) throw new Error("HarfBuzz could not start a font subset.");
            const unicodes = hb.hb_subset_input_unicode_set(input);
            if (codePoints) for (const point of codePoints) hb.hb_set_add(unicodes, point);
            else hb.hb_set_invert(hb.hb_subset_input_glyph_set(input));
            if (retainGids) hb.hb_subset_input_set_flags(input, RETAIN_GIDS);
            // Freeze all axes so viewers cannot apply a different instance to the embedded font.
            hb.hb_subset_input_pin_all_axes_to_default(input, face);
            for (const [name, value] of Object.entries(axes ?? {})) {
              const tag = [...name].reduce((number, char) => number * 256 + char.charCodeAt(0), 0);
              hb.hb_subset_input_pin_axis_location(input, face, tag, value);
            }
            result = hb.hb_subset_or_fail(face, input);
            if (!result) throw new Error("HarfBuzz could not subset a figure font.");
            blob = hb.hb_face_reference_blob(result);
            const length = hb.hb_blob_get_length(blob);
            if (!length) throw new Error("HarfBuzz returned an empty subset of a figure font.");
            const pointer = hb.hb_blob_get_data(blob, 0);
            return heap().slice(pointer, pointer + length);
          } finally {
            if (blob) hb.hb_blob_destroy(blob);
            if (result) hb.hb_face_destroy(result);
            if (input) hb.hb_subset_input_destroy(input);
            hb.hb_face_destroy(face);
            hb.hb_blob_destroy(source);
            hb.free(data);
          }
        },
      };
    },
  };
}
