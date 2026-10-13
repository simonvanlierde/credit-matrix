import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthor, decodeShareHash } from "@/core";
import { buildShareUrl, shareFailureKey } from "./share";

describe("buildShareUrl", () => {
  it("links to this page", async () => {
    const url = await buildShareUrl({ authors: [createAuthor("Jane Smith")] });
    expect(url.startsWith(`${window.location.origin}${window.location.pathname}#s=`)).toBe(true);
    expect((await decodeShareHash(url.slice(url.indexOf("#"))))?.authors[0]?.name).toBe("Jane Smith");
  });
});

describe("shareFailureKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blames the browser, not the draft, when there is no CompressionStream", () => {
    expect(shareFailureKey()).toBe("errShareTooLarge");

    // A pre-2023 browser cannot build any link; telling that user to trim their
    // roster sends them fixing something that was never the problem.
    vi.stubGlobal("CompressionStream", undefined);
    expect(shareFailureKey()).toBe("errShareUnsupported");
  });
});
