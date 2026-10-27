import { crc32, deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { withPngText } from "./png-text";

/** A valid 1×1 grey PNG built from parts, so the test needs no fixture file. */
function onePixelPng(): Uint8Array<ArrayBuffer> {
  const chunk = (type: string, data: Uint8Array) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    out.write(type, 4, "ascii");
    Buffer.from(data).copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  // Copied into a plain ArrayBuffer: a Buffer's may be shared.
  return new Uint8Array(
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(Buffer.from([0, 128]))),
      chunk("IEND", new Uint8Array()),
    ]),
  );
}

/** Every chunk as [type, data], checking each CRC on the way. */
function chunks(png: Uint8Array): [string, Buffer][] {
  const buf = Buffer.from(png);
  const out: [string, Buffer][] = [];
  for (let i = 8; i < buf.length; ) {
    const len = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    const crc = crc32(buf.subarray(i + 4, i + 8 + len));
    expect(buf.readUInt32BE(i + 8 + len), `${type} CRC`).toBe(crc);
    out.push([type, buf.subarray(i + 8, i + 8 + len)]);
    i += 12 + len;
  }
  return out;
}

describe("withPngText", () => {
  it("adds a Description iTXt chunk after IHDR with a valid CRC and UTF-8 text", () => {
    const text = "CRediT: Jane Smith: Conceptualization; Ōno Ken: Software";
    const out = chunks(withPngText(onePixelPng(), "Description", text));
    expect(out.map(([type]) => type)).toEqual(["IHDR", "iTXt", "IDAT", "IEND"]);
    const data = out[1]?.[1] ?? Buffer.alloc(0);
    expect(data.subarray(0, 16).toString("latin1")).toBe("Description\0\0\0\0\0");
    expect(data.subarray(16).toString("utf8")).toBe(text);
    // The image data is untouched.
    expect(inflateSync(out[2]?.[1] ?? Buffer.alloc(0))).toEqual(Buffer.from([0, 128]));
  });

  it("writes the language tag into the iTXt chunk", () => {
    const out = chunks(withPngText(onePixelPng(), "Description", "x", "pt-BR"));
    const data = out[1]?.[1] ?? Buffer.alloc(0);
    expect(data.toString("latin1")).toBe("Description\0\0\0pt-BR\0\0x");
  });

  it("leaves anything that is not a PNG alone", () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(withPngText(junk, "Description", "x")).toBe(junk);
  });
});
