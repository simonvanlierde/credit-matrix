import { encodeShareHash, type SharePayloadInput } from "@/core";
import { UnsharableDraftError } from "@/core/share-payload";

/** A share link to this page for the draft. See `encodeShareHash`. */
export function buildShareUrl(input: SharePayloadInput): Promise<string> {
  const { origin, pathname } = window.location;
  return encodeShareHash(input, `${origin}${pathname}`);
}

/**
 * Which failure to report when buildShareUrl throws `error`: a pre-2023 browser
 * with no CompressionStream cannot build any link, and a draft the share reader
 * would refuse (duplicate ids, a claim on a missing row) is not "too large";
 * either wrong message sends the user trimming a roster that was never the problem.
 */
export function shareFailureKey(error: unknown): "errShareUnsupported" | "errShareInvalid" | "errShareTooLarge" {
  if (error instanceof UnsharableDraftError) return "errShareInvalid";
  return typeof CompressionStream === "undefined" ? "errShareUnsupported" : "errShareTooLarge";
}
