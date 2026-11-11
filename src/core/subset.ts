export interface SubsetFace {
  /**
   * A standalone font with these code points' glyphs and the layout tables that reach them, at the default
   * instance of a variable font. With `retainGids`, every glyph keeps its id, so ids from the whole face stay valid.
   */
  subset(codePoints: Iterable<number>, retainGids: boolean): Uint8Array;
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
  const hb = instance.exports as Record<string, (...args: number[]) => number> & { memory: { buffer: ArrayBuffer } };
  hb._initialize?.();
  // A view of memory as it is now: any call can grow it and detach an older view.
  const heap = () => new Uint8Array(hb.memory.buffer);
  return {
    face(bytes) {
      return {
        subset(codePoints, retainGids) {
          // The module's memory is fixed at 64 MB, so each subset copies its face in and frees it again
          // (about 10 ms for a 14 MB face) rather than keeping every face a long-lived renderer has seen.
          const data = hb.malloc?.(bytes.length) ?? 0;
          if (!data)
            throw new Error(`A ${Math.round(bytes.length / 1e6)} MB font is too large for HarfBuzz's subsetter.`);
          heap().set(bytes, data);
          const source = hb.hb_blob_create?.(data, bytes.length, READONLY, 0, 0) ?? 0;
          const face = hb.hb_face_create?.(source, 0) ?? 0;
          const input = hb.hb_subset_input_create_or_fail?.() ?? 0;
          try {
            if (!input) throw new Error("HarfBuzz could not start a font subset.");
            const unicodes = hb.hb_subset_input_unicode_set?.(input) ?? 0;
            for (const point of codePoints) hb.hb_set_add?.(unicodes, point);
            if (retainGids) hb.hb_subset_input_set_flags?.(input, RETAIN_GIDS);
            // A no-op for a static face; a variable one becomes its default instance, which fontkit measures.
            hb.hb_subset_input_pin_all_axes_to_default?.(input, face);
            const result = hb.hb_subset_or_fail?.(face, input) ?? 0;
            if (!result) throw new Error("HarfBuzz could not subset a figure font.");
            const blob = hb.hb_face_reference_blob?.(result) ?? 0;
            const length = hb.hb_blob_get_length?.(blob) ?? 0;
            if (!length) throw new Error("HarfBuzz returned an empty subset of a figure font.");
            const pointer = hb.hb_blob_get_data?.(blob, 0) ?? 0;
            const out = heap().slice(pointer, pointer + length);
            hb.hb_blob_destroy?.(blob);
            hb.hb_face_destroy?.(result);
            return out;
          } finally {
            if (input) hb.hb_subset_input_destroy?.(input);
            hb.hb_face_destroy?.(face);
            hb.hb_blob_destroy?.(source);
            hb.free?.(data);
          }
        },
      };
    },
  };
}
