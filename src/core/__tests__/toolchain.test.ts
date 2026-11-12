import { describe, expect, it } from "vitest";
import { fromJson, toJson, UNKNOWN_TOOLCHAIN_WARNING } from "../export/json";
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

  it.each(["rmarkdown", "Quarto", "", null, 1])(
    "drops an unknown imported toolchain %j and keeps the authors",
    async (toolchain) => {
      const authors = [createAuthor("Grace Hopper")];
      const json = JSON.stringify({ ...JSON.parse(toJson(authors)), toolchain });
      expect(fromJson(json)).toEqual({ authors, warnings: [UNKNOWN_TOOLCHAIN_WARNING] });
      expect(UNKNOWN_TOOLCHAIN_WARNING).toMatch(/writing tool/);
      expect(await importAny(json)).toEqual({ format: "json", authors, warnings: [UNKNOWN_TOOLCHAIN_WARNING] });
      const link = JSON.parse(toSharePayload({ authors }));
      const shared = fromSharePayload(JSON.stringify({ ...link, h: toolchain }));
      expect(shared.authors.map((author) => author.name)).toEqual(["Grace Hopper"]);
      expect(shared).not.toHaveProperty("toolchain");
    },
  );
});
