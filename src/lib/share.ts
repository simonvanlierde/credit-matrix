import type { ShareData, SharePayloadInput } from "@credit-generator/core";
import { fromSharePayload, MAX_IMPORT_BYTES, toSharePayload } from "@credit-generator/core";

export type { ShareData } from "@credit-generator/core";

/** The payload is base64url over deflate-raw compressed JSON. */
const HASH_PREFIX = "#s=";
const MAX_ENCODED_LENGTH = Math.ceil((MAX_IMPORT_BYTES * 4) / 3) + 4;

/**
 * base64url encode/decode with a fallback: the TC39 Uint8Array.toBase64 /
 * fromBase64 methods only landed in browsers from late 2024/2025, so feature-
 * detect and fall back to btoa/atob for older engines instead of throwing.
 */
function toBase64Url(bytes: Uint8Array): string {
  if (typeof bytes.toBase64 === "function") {
    return bytes.toBase64({ alphabet: "base64url", omitPadding: true });
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/[=]+$/, "");
}

function fromBase64Url(encoded: string): Uint8Array {
  if (typeof Uint8Array.fromBase64 === "function") {
    return Uint8Array.fromBase64(encoded, { alphabet: "base64url" });
  }
  const binary = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Push bytes through a compression transform and collect the output, refusing
 * to grow past `maxBytes`: on the inflate side a few kB of hostile input can
 * otherwise decompress to gigabytes out of a mount effect.
 */
async function transformBytes(
  bytes: Uint8Array,
  transform: ReadableWritablePair<Uint8Array, BufferSource>,
  maxBytes: number,
): Promise<Uint8Array> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  // The DOM lib types the writable side as WritableStream<BufferSource>, which
  // pipeThrough's ReadableWritablePair<T, Uint8Array> shape rejects; the bytes
  // fed in are Uint8Arrays, so the pair is narrower in practice than in type.
  const reader = source.pipeThrough(transform as ReadableWritablePair<Uint8Array, Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Share payload is too large.");
    }
    chunks.push(value);
  }
  return new Uint8Array(await new Blob(chunks as Uint8Array<ArrayBuffer>[]).arrayBuffer());
}

/** Deflate the payload so the link stays short enough to paste into an email. */
function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  // Deflate never grows input meaningfully; the bound is a formality.
  return transformBytes(bytes, new CompressionStream("deflate-raw"), MAX_IMPORT_BYTES);
}

/** Inflate, capped at the same size every other import path enforces. */
function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  return transformBytes(bytes, new DecompressionStream("deflate-raw"), MAX_IMPORT_BYTES);
}

/**
 * Build a shareable absolute URL that encodes the v2 payload — authors plus
 * the title/claim/source-draft/reply envelope — deflate-compressed, in the
 * fragment. Throws on a browser without CompressionStream (pre-2023); the
 * caller already turns a throw into the copy-failed state.
 */
export async function buildShareUrl(input: SharePayloadInput): Promise<string> {
  const bytes = new TextEncoder().encode(toSharePayload(input));
  if (bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new Error("This draft is too large to share as a link.");
  }
  const encoded = toBase64Url(await deflate(bytes));
  const { origin, pathname } = window.location;
  return `${origin}${pathname}${HASH_PREFIX}${encoded}`;
}

/**
 * Decode a `#s=…` location hash into the v2 payload. Returns null when the
 * hash is absent, malformed, or a v1-era link (bare payload, or one with a
 * trailing `&c=`/`&d=` tail from before the envelope moved inside the
 * payload), so a bad or stale link degrades to the normal app rather than
 * crashing.
 */
/**
 * Which failure to report when buildShareUrl throws: a pre-2023 browser with
 * no CompressionStream cannot build any link, and telling that user their
 * draft is "too large" sends them trimming a roster that was never the problem.
 */
export function shareFailureKey(): "errShareUnsupported" | "errShareTooLarge" {
  return typeof CompressionStream === "undefined" ? "errShareUnsupported" : "errShareTooLarge";
}

export async function decodeShareHash(hash: string): Promise<ShareData | null> {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const encoded = hash.slice(HASH_PREFIX.length);
  if (encoded.length > MAX_ENCODED_LENGTH || !/^[A-Za-z0-9_-]+$/.test(encoded)) return null;

  try {
    // inflate caps the decompressed size at MAX_IMPORT_BYTES.
    const bytes = await inflate(fromBase64Url(encoded));
    return fromSharePayload(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
}
