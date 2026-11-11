import { describe, expect, it } from "vitest";
import { fromJson, toJson } from "../export/json";
import { importAny } from "../import";
import { createAuthor } from "../parse-authors";
import { decodeShareHash, encodeShareHash } from "../share-link";
import { fromSharePayload, toSharePayload } from "../share-payload";

const toolchains = ["word", "markdown", "latex", "quarto", "typst", "pandoc", "myst", "sphinx"] as const;

describe("draft toolchain", () => {
  it.each(toolchains)("round-trips %s through JSON and share-link imports", async (toolchain) => {
    const authors = [createAuthor("Grace Hopper")];
    const json = toJson(authors, { toolchain });
    expect(fromJson(json)).toEqual({ authors, toolchain });
    expect(await importAny(json)).toEqual({ format: "json", authors, toolchain });
    const hash = await encodeShareHash({ authors, toolchain });
    expect((await decodeShareHash(hash))?.toolchain).toBe(toolchain);
    expect((await importAny(hash)).toolchain).toBe(toolchain);
  });

  it("keeps old files and links without a toolchain optional", () => {
    expect(fromJson(toJson([]))).not.toHaveProperty("toolchain");
    expect(fromSharePayload(toSharePayload({ authors: [] }))).not.toHaveProperty("toolchain");
  });

  it.each(["unknown", "", null, 1])("rejects an invalid imported toolchain %j", (toolchain) => {
    expect(() => fromJson(JSON.stringify({ version: 1, authors: [], toolchain }))).toThrow();
    expect(() => fromSharePayload(JSON.stringify({ v: 2, a: [], h: toolchain }))).toThrow();
  });
});
