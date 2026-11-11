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
      // shortcut: faces are never freed; a renderer loads each at most once per process.
      const data = hb.malloc?.(bytes.length) ?? 0;
      heap().set(bytes, data);
      const face = hb.hb_face_create?.(hb.hb_blob_create?.(data, bytes.length, READONLY, 0, 0) ?? 0, 0) ?? 0;
      return {
        subset(codePoints, retainGids) {
          const input = hb.hb_subset_input_create_or_fail?.() ?? 0;
          if (!input) throw new Error("HarfBuzz could not start a font subset.");
          const unicodes = hb.hb_subset_input_unicode_set?.(input) ?? 0;
          for (const point of codePoints) hb.hb_set_add?.(unicodes, point);
          if (retainGids) hb.hb_subset_input_set_flags?.(input, RETAIN_GIDS);
          // A no-op for a static face; a variable one becomes its default instance, which fontkit measures.
          hb.hb_subset_input_pin_all_axes_to_default?.(input, face);
          const result = hb.hb_subset_or_fail?.(face, input) ?? 0;
          hb.hb_subset_input_destroy?.(input);
          if (!result) throw new Error("HarfBuzz could not subset a figure font.");
          const blob = hb.hb_face_reference_blob?.(result) ?? 0;
          const length = hb.hb_blob_get_length?.(blob) ?? 0;
          const pointer = hb.hb_blob_get_data?.(blob, 0) ?? 0;
          const out = heap().slice(pointer, pointer + length);
          hb.hb_blob_destroy?.(blob);
          hb.hb_face_destroy?.(result);
          return out;
        },
      };
    },
  };
}
