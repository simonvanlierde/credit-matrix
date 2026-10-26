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

/**
 * Add an uncompressed iTXt chunk (UTF-8 text) right after a PNG's IHDR chunk.
 * "Description" is the PNG spec's keyword for an image's text alternative.
 * Returns the input unchanged if it is not a PNG with an IHDR first.
 */
export function withPngText(png: Uint8Array<ArrayBuffer>, keyword: string, text: string): Uint8Array<ArrayBuffer> {
  // 8-byte signature, then IHDR: 4 length + 4 type + 13 data + 4 CRC.
  const ihdrEnd = 33;
  if (png.length < ihdrEnd || String.fromCharCode(...png.subarray(12, 16)) !== "IHDR") return png;
  const enc = new TextEncoder();
  // keyword NUL, compression flag 0, method 0, empty language tag NUL, empty translated keyword NUL.
  const data = new Uint8Array([...enc.encode(keyword), 0, 0, 0, 0, 0, ...enc.encode(text)]);
  const chunk = new Uint8Array(12 + data.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(enc.encode("iTXt"), 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.length, crc32(chunk.subarray(4, 8 + data.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd));
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}
