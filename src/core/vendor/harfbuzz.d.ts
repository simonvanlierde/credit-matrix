// Types for the Emscripten loader vendored from harfbuzzjs 1.6.4 (dist/harfbuzz.js, MIT).
export interface HarfBuzzModule {
  wasmExports: Record<string, (...args: number[]) => number>;
  HEAPU8: Uint8Array;
  HEAPU16: Uint16Array;
  HEAP32: Int32Array;
  HEAPU32: Uint32Array;
}

declare function createHarfBuzz(options: { wasmBinary: Uint8Array }): Promise<HarfBuzzModule>;
export default createHarfBuzz;
