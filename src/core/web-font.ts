import { FigureFontFileError, nodeModule } from "./figure-fonts";

const MAX_FONT = 64 * 1024 * 1024;
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Convert web containers to sfnt before HarfBuzz sees them; fontkit cannot subset transformed WOFF2 tables. */
export async function decodeWebFont(bytes: Uint8Array): Promise<Uint8Array> {
  const signature = String.fromCharCode(...bytes.subarray(0, 4));
  if (signature !== "wOFF" && signature !== "wOF2") return bytes;
  const data = view(bytes);
  if (bytes.length > MAX_FONT) throw new FigureFontFileError("The web font exceeds 64 MiB.");
  if (bytes.length < (signature === "wOFF" ? 44 : 48) || data.getUint32(16) > MAX_FONT)
    throw new FigureFontFileError("The web font is truncated or expands past 64 MiB.");
  if (signature === "wOF2") {
    // Bound transformed table sizes too: the header's sfnt size alone does not bound decoder memory.
    let cursor = 48;
    let transformedSize = 0;
    const base128 = () => {
      let value = 0;
      for (let index = 0; index < 5; index++) {
        const byte = data.getUint8(cursor++);
        value = value * 128 + (byte % 128);
        if (value > MAX_FONT) throw new FigureFontFileError("The web font expands past 64 MiB.");
        if (byte < 128) return value;
      }
      throw new FigureFontFileError("The web font has an invalid table length.");
    };
    for (let index = 0; index < data.getUint16(12); index++) {
      const flags = data.getUint8(cursor++);
      const tag = flags % 64;
      if (tag === 63) cursor += 4;
      const length = base128();
      const version = Math.floor(flags / 64);
      const transformed = tag === 10 || tag === 11 ? version === 0 : version !== 0;
      transformedSize += transformed ? base128() : length;
      if (transformedSize > MAX_FONT) throw new FigureFontFileError("The web font expands past 64 MiB.");
    }
    const { default: decompress } = await import("woff2-encoder/decompress");
    const decoded = await decompress(bytes);
    if (decoded.length > MAX_FONT) throw new FigureFontFileError("The web font expands past 64 MiB.");
    return decoded;
  }
  const count = data.getUint16(12);
  if (!count || count > 4095 || 44 + count * 20 > bytes.length || 12 + count * 16 > data.getUint32(16))
    throw new FigureFontFileError("The web font has an invalid table directory.");
  const result = new Uint8Array(data.getUint32(16));
  const output = view(result);
  result.set(bytes.subarray(4, 8));
  output.setUint16(4, count);
  const power = 2 ** Math.floor(Math.log2(count));
  output.setUint16(6, power * 16);
  output.setUint16(8, Math.log2(power));
  output.setUint16(10, count * 16 - power * 16);
  let at = 12 + count * 16;
  let head = -1;
  for (let index = 0; index < count; index++) {
    const record = 44 + index * 20;
    const offset = data.getUint32(record + 4);
    const compressed = data.getUint32(record + 8);
    const length = data.getUint32(record + 12);
    if (offset + compressed > bytes.length || at + length > result.length || compressed > length)
      throw new FigureFontFileError("The web font has an invalid table length.");
    let table = bytes.subarray(offset, offset + compressed);
    if (compressed < length) {
      if ((globalThis as { process?: NodeJS.Process }).process?.versions?.node) {
        const { inflateSync } = await nodeModule<typeof import("node:zlib")>("node:zlib");
        table = new Uint8Array(inflateSync(table, { maxOutputLength: length }));
      } else {
        const { DecompressionStream, Blob } = globalThis as unknown as typeof import("node:stream/web") & {
          Blob: new (parts: unknown[]) => { stream(): import("node:stream/web").ReadableStream };
        };
        const stream = new Blob([table]).stream().pipeThrough(new DecompressionStream("deflate"));
        const reader = stream.getReader();
        const decoded = new Uint8Array(length);
        let written = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = value as Uint8Array;
            if (written + chunk.length > length)
              throw new FigureFontFileError("The web font has an invalid decompressed table length.");
            decoded.set(chunk, written);
            written += chunk.length;
          }
        } finally {
          await reader.cancel();
        }
        if (written !== length) throw new FigureFontFileError("The web font has an invalid decompressed table length.");
        table = decoded;
      }
    }
    if (table.length !== length)
      throw new FigureFontFileError("The web font has an invalid decompressed table length.");
    const target = 12 + index * 16;
    result.set(bytes.subarray(record, record + 4), target);
    output.setUint32(target + 4, data.getUint32(record + 16));
    output.setUint32(target + 8, at);
    output.setUint32(target + 12, length);
    result.set(table, at);
    if (data.getUint32(record) === 0x68656164 && length >= 12) head = at;
    at += Math.ceil(length / 4) * 4;
  }
  if (at !== result.length || head < 0)
    throw new FigureFontFileError("The web font has an invalid sfnt length or head table.");
  output.setUint32(head + 8, 0);
  let sum = 0;
  for (let offset = 0; offset < result.length; offset += 4) sum = (sum + output.getUint32(offset)) % 2 ** 32;
  output.setUint32(head + 8, (0xb1b0afba - sum + 2 ** 32) % 2 ** 32);
  return result;
}
