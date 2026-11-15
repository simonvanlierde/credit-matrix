import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthor, decodeShareHash } from "@/core";
import { UnsharableDraftError } from "@/core/share-payload";
import { buildShareUrl, shareFailureKey } from "./share";

describe("buildShareUrl", () => {
  it("links to this page", async () => {
    const url = await buildShareUrl({ authors: [createAuthor("Grace Hopper")] });
    expect(url.startsWith(`${window.location.origin}${window.location.pathname}#s=`)).toBe(true);
    expect((await decodeShareHash(url.slice(url.indexOf("#"))))?.authors[0]?.name).toBe("Grace Hopper");
  });
});

describe("shareFailureKey", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("blames the browser, not the draft, when there is no CompressionStream", () => {
    expect(shareFailureKey(new Error("too large"))).toBe("errShareTooLarge");

    // A pre-2023 browser cannot build any link; telling that user to trim their
    // roster sends them fixing something that was never the problem.
    vi.stubGlobal("CompressionStream", undefined);
    expect(shareFailureKey(new Error("no stream"))).toBe("errShareUnsupported");
  });

  it("says the draft itself cannot be shared when the payload is refused", async () => {
    const grace = createAuthor("Grace Hopper");
    const error = await buildShareUrl({ authors: [grace, { ...grace }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsharableDraftError);
    expect(shareFailureKey(error)).toBe("errShareInvalid");
  });
});
