// biome-ignore lint/correctness/noNodejsModules: tests run in Node; zlib hand-builds hostile payloads
import { deflateRawSync } from "node:zlib";
import { createAuthor, toSharePayload } from "@credit-generator/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildShareUrl, decodeShareHash, shareFailureKey } from "./share";

function draft() {
  return [
    createAuthor("Jane A. Smith", { contributions: [{ role: "Conceptualization", score: 100 }] }),
    createAuthor("Bob White", { contributions: [{ role: "Investigation", score: 100 }] }),
  ];
}

/** The fragment of a built URL, which is what `decodeShareHash` takes. */
function hashOf(url: string): string {
  return url.slice(url.indexOf("#"));
}

/** Deflate + base64url, as buildShareUrl does, for hand-built payloads. */
function compressedHash(payload: string): string {
  return `#s=${deflateRawSync(Buffer.from(payload)).toString("base64url")}`;
}

describe("share links", () => {
  it("compresses the payload, not just encodes it", async () => {
    const authors = Array.from({ length: 10 }, (_, i) =>
      createAuthor(`Author ${i} Name`, { contributions: [{ role: "Software", score: 66 }] }),
    );
    const fragment = hashOf(await buildShareUrl({ authors }));
    const uncompressed = Buffer.from(toSharePayload({ authors })).toString("base64url");

    // The exact ratio is not the contract; shorter than plain base64 is.
    expect(fragment.length).toBeLessThan(uncompressed.length / 2);
  });

  it("returns null for a hash that is not a share link", async () => {
    expect(await decodeShareHash("")).toBeNull();
    expect(await decodeShareHash("#other=1")).toBeNull();
    expect(await decodeShareHash("#s=not-base64!!")).toBeNull();
    // Valid base64url, but not deflate data.
    expect(await decodeShareHash("#s=aGVsbG8")).toBeNull();
  });

  it("refuses a decompression bomb instead of inflating it", async () => {
    // ~2 MB of zeros deflates to a few kB but must not decode past the cap.
    const bomb = compressedHash("0".repeat(2_000_000));
    expect(await decodeShareHash(bomb)).toBeNull();
  });

  it("round-trips a full v2 envelope through the fragment", async () => {
    const authors = draft();
    const url = await buildShareUrl({
      authors,
      title: "Eel cognition",
      claimId: authors[1]?.id,
      sourceDraftId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      reply: true,
    });
    expect(url).toContain("#s=");
    expect(url).not.toContain("&"); // the envelope lives inside the payload now

    const decoded = await decodeShareHash(hashOf(url));
    expect(decoded?.claimId).toBe(authors[1]?.id);
    expect(decoded?.sourceDraftId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    expect(decoded?.reply).toBe(true);
    expect(decoded?.title).toBe("Eel cognition");
    expect(decoded?.authors.map((a) => a.id)).toEqual([authors[1]?.id]);
  });

  it("returns null for a v1-era link with trailing parameters", async () => {
    const base = hashOf(await buildShareUrl({ authors: draft() }));
    expect(await decodeShareHash(`${base}&c=1&d=paper-2`)).toBeNull();
  });

  it("returns null for a v1 payload", async () => {
    expect(await decodeShareHash(compressedHash(JSON.stringify({ v: 1, a: [{ n: "Jane Smith", s: [] }] })))).toBeNull();
  });

  it("round-trips through btoa/atob on an engine without Uint8Array.toBase64", async () => {
    // The TC39 methods only landed in browsers from late 2024; the fallback is
    // what an older engine takes, and it has to produce the same link.
    const { toBase64 } = Uint8Array.prototype;
    const { fromBase64 } = Uint8Array;
    // Deleted, not set to undefined: the feature detection is `typeof x === "function"`.
    delete (Uint8Array.prototype as { toBase64?: unknown }).toBase64;
    delete (Uint8Array as { fromBase64?: unknown }).fromBase64;

    try {
      const authors = draft();
      const url = await buildShareUrl({ authors, title: "Eel cognition" });
      expect(url).toContain("#s=");
      // base64url, not base64: `+/=` would be mangled in a fragment.
      expect(hashOf(url)).toMatch(/^#s=[\w-]+$/);

      const decoded = await decodeShareHash(hashOf(url));
      expect(decoded?.title).toBe("Eel cognition");
      expect(decoded?.authors.map((a) => a.name)).toEqual(authors.map((a) => a.name));
    } finally {
      Object.assign(Uint8Array.prototype, { toBase64 });
      Object.assign(Uint8Array, { fromBase64 });
    }
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
