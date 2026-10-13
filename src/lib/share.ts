import { encodeShareHash, type SharePayloadInput } from "@/core";

/** A share link to this page for the draft. See `encodeShareHash`. */
export function buildShareUrl(input: SharePayloadInput): Promise<string> {
  const { origin, pathname } = window.location;
  return encodeShareHash(input, `${origin}${pathname}`);
}

/**
 * Which failure to report when buildShareUrl throws: a pre-2023 browser with
 * no CompressionStream cannot build any link, and telling that user their
 * draft is "too large" sends them trimming a roster that was never the problem.
 */
export function shareFailureKey(): "errShareUnsupported" | "errShareTooLarge" {
  return typeof CompressionStream === "undefined" ? "errShareUnsupported" : "errShareTooLarge";
}
