// biome-ignore-all lint/correctness/noNodejsModules: fixtures and compression for malformed font inputs.
import { readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectFigureFont } from "../font-search";
import { decodeWebFont } from "../web-font";

function container(signature: string, size = 48): Buffer {
  const bytes = Buffer.alloc(size);
  bytes.write(signature);
  bytes.writeUInt32BE(40, 16);
  return bytes;
}

/** One compressed head table, enough to exercise container validation without a whole typeface. */
function woff(storedSize: number, declaredSize = storedSize): Buffer {
  const compressed = deflateSync(Buffer.alloc(storedSize));
  const bytes = container("wOFF", 64 + compressed.length);
  bytes.writeUInt16BE(1, 12);
  bytes.writeUInt32BE(28 + Math.ceil(declaredSize / 4) * 4, 16);
  bytes.write("head", 44);
  bytes.writeUInt32BE(64, 48);
  bytes.writeUInt32BE(compressed.length, 52);
  bytes.writeUInt32BE(declaredSize, 56);
  bytes.set(compressed, 64);
  return bytes;
}

function sfnt(): Buffer {
  return readFileSync(new URL("fixtures/fonts/FigureTest-Regular.ttf", import.meta.url));
}

function record(bytes: Buffer, name: string): number {
  for (let at = 12; at < 12 + bytes.readUInt16BE(4) * 16; at += 16)
    if (bytes.toString("latin1", at, at + 4) === name) return at;
  throw new Error(`Fixture lacks ${name}`);
}

afterEach(() => vi.unstubAllGlobals());

describe("untrusted font containers", () => {
  it("decodes WOFF2 when Content Security Policy forbids JavaScript string evaluation", async () => {
    const bytes = readFileSync(new URL("fixtures/fonts/FigureTestWeb-Regular.woff2", import.meta.url));
    const blocked = () => {
      throw new Error("JavaScript string evaluation is disabled");
    };
    vi.stubGlobal("Function", new Proxy(Function, { apply: blocked, construct: blocked }));
    const decoded = await decodeWebFont(bytes);
    const found = await inspectFigureFont(decoded);
    expect(found.family).toBe("Figure Test Web");
    expect(decoded.subarray(0, 4)).toEqual(new Uint8Array([0, 1, 0, 0]));
  });

  it("rejects truncated, oversized and implausible web-font headers", async () => {
    await expect(decodeWebFont(Buffer.from("wOFF"))).rejects.toThrow(/truncated/);
    const huge = container("wOF2");
    huge.writeUInt32BE(64 * 1024 * 1024 + 1, 16);
    await expect(decodeWebFont(huge)).rejects.toThrow(/64 MiB/);
    await expect(decodeWebFont(container("wOFF"))).rejects.toThrow(/table directory/);
    const input = Buffer.alloc(64 * 1024 * 1024 + 1);
    input.write("wOFF");
    await expect(decodeWebFont(input)).rejects.toThrow(/exceeds 64 MiB/);
  });

  it("bounds transformed WOFF2 tables before loading a decoder", async () => {
    const bytes = container("wOF2", 64);
    bytes.writeUInt16BE(1, 12);
    bytes.set([0, 0x80, 0x80, 0x80, 0x80, 0x80], 48);
    await expect(decodeWebFont(bytes)).rejects.toThrow(/invalid table length/);
    bytes.set([0, 0xff, 0xff, 0xff, 0xff, 0xff], 48);
    await expect(decodeWebFont(bytes)).rejects.toThrow(/64 MiB/);
    bytes.writeUInt16BE(2, 12);
    // Each table claims 40 MiB, whose sum exceeds the decoder's memory allowance.
    bytes.set([0, 0x94, 0x80, 0x80, 0, 0, 0x94, 0x80, 0x80, 0], 48);
    await expect(decodeWebFont(bytes)).rejects.toThrow(/64 MiB/);
  });

  it("rejects WOFF tables outside the input and short decompression results", async () => {
    const badOffset = woff(64);
    badOffset.writeUInt32BE(badOffset.length, 48);
    await expect(decodeWebFont(badOffset)).rejects.toThrow(/invalid table length/);
    await expect(decodeWebFont(woff(64, 128))).rejects.toThrow(/decompressed table length/);
    const badSize = woff(64);
    badSize.writeUInt32BE(96, 16);
    await expect(decodeWebFont(badSize)).rejects.toThrow(/sfnt length/);
    const noHead = woff(64);
    noHead.write("name", 44);
    await expect(decodeWebFont(noHead)).rejects.toThrow(/head table/);
  });

  it("bounds native browser decompression on both short and long output", async () => {
    vi.stubGlobal("process", undefined);
    await expect(decodeWebFont(woff(64, 128))).rejects.toThrow(/decompressed table length/);
    await expect(decodeWebFont(woff(256, 128))).rejects.toThrow(/decompressed table length/);
  });

  it("rejects missing sfnt tables and directories that reach outside the file", async () => {
    await expect(inspectFigureFont(Buffer.from("no font"))).rejects.toThrow(/standalone/);
    const directory = sfnt();
    directory.writeUInt16BE(65535, 4);
    await expect(inspectFigureFont(directory)).rejects.toThrow(/truncated font directory/);
    const truncated = sfnt();
    truncated.writeUInt32BE(truncated.length, record(truncated, "cmap") + 8);
    await expect(inspectFigureFont(truncated)).rejects.toThrow(/truncated cmap/);
    const missing = sfnt();
    missing.writeUInt32BE(0, record(missing, "head") + 12);
    await expect(inspectFigureFont(missing)).rejects.toThrow(/no readable head/);
    const noName = sfnt();
    noName.writeUInt16BE(0, noName.readUInt32BE(record(noName, "name") + 8) + 2);
    await expect(inspectFigureFont(noName)).rejects.toThrow(/no readable font family name/);
  });
});
