const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = (CRC_TABLE[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function isPng(png: Uint8Array): boolean {
  return (
    png.length >= 33 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => png[i] === byte) &&
    String.fromCharCode(...png.subarray(12, 16)) === "IHDR"
  );
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(new TextEncoder().encode(type), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  return chunk;
}

/**
 * Add an uncompressed iTXt chunk (UTF-8 text) right after a PNG's IHDR chunk.
 * "Description" is the PNG spec's keyword for an image's text alternative.
 * `language` is the text's BCP-47 tag, written into the chunk's language field.
 * Returns the input unchanged if it is not a PNG with an IHDR first.
 */
export function withPngText(
  png: Uint8Array<ArrayBuffer>,
  keyword: string,
  text: string,
  language = "",
): Uint8Array<ArrayBuffer> {
  // 8-byte signature, then IHDR: 4 length + 4 type + 13 data + 4 CRC.
  const ihdrEnd = 33;
  if (!isPng(png)) return png;
  const enc = new TextEncoder();
  // keyword NUL, compression flag 0, method 0, language tag NUL, empty translated keyword NUL.
  const data = new Uint8Array([...enc.encode(keyword), 0, 0, 0, ...enc.encode(language), 0, 0, ...enc.encode(text)]);
  const chunk = pngChunk("iTXt", data);
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd));
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

/** Set PNG print density, replacing any existing pHYs chunk. Other chunks stay byte-for-byte intact. */
export function withPngResolution(png: Uint8Array<ArrayBuffer>, dpi: number): Uint8Array<ArrayBuffer> {
  if (!Number.isFinite(dpi) || dpi <= 0 || dpi > 2400)
    throw new RangeError("PNG resolution must be between 0 and 2400 dpi.");
  if (!isPng(png)) return png;
  const data = new Uint8Array(9);
  const view = new DataView(data.buffer);
  const pixelsPerMetre = Math.round(dpi / 0.0254);
  view.setUint32(0, pixelsPerMetre);
  view.setUint32(4, pixelsPerMetre);
  data[8] = 1;
  const parts = [png.subarray(0, 33), pngChunk("pHYs", data)];
  const input = new DataView(png.buffer, png.byteOffset, png.byteLength);
  for (let offset = 33; offset < png.length; ) {
    if (offset + 12 > png.length) return png;
    const end = offset + 12 + input.getUint32(offset);
    if (end > png.length) return png;
    if (String.fromCharCode(...png.subarray(offset + 4, offset + 8)) !== "pHYs") parts.push(png.subarray(offset, end));
    offset = end;
  }
  const out = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
