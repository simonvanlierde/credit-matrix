import type { useTranslations } from "use-intl";
import { normalizeOrcid } from "@/core";
import { ORCID_REGEX } from "@/core/author";
import { lookupOrcidPerson } from "@/core/lookup";

const ORCID_EXTRACT_REGEX = /(\d{4}-\d{4}-\d{4}-\d{3}[0-9X])/i;

/** Pull a valid ORCID iD out of arbitrary text (a raw id or an orcid.org URL). */
export function detectOrcid(text: string): string | null {
  const candidate = text.trim().match(ORCID_EXTRACT_REGEX)?.[1]?.toUpperCase() ?? "";
  return ORCID_REGEX.test(candidate) ? candidate : null;
}

/**
 * The name typed beside an ORCID iD ("Jane Smith 0000-…"), or null when the
 * text is only the iD, bare or as an orcid.org link.
 */
export function nameBesideOrcid(text: string): string | null {
  const rest = trimSeparators(
    text
      .replace(/(?:https?:\/\/)?(?:www\.)?orcid\.org\/|\borcid\b(?:\s+id\b)?:?/gi, " ")
      .replace(ORCID_EXTRACT_REGEX, " "),
  ).replace(/\s+/g, " ");
  return /\p{L}/u.test(rest) ? rest : null;
}

const SEPARATOR = /[\s,;:()[\]<>|–—\-、，。：；（）［］]/;

/** Strip separators from both ends; a loop, since an end-anchored regex is quadratic on long inner runs. */
function trimSeparators(text: string): string {
  let start = 0;
  let end = text.length;
  while (start < end && SEPARATOR.test(text[start] ?? "")) start += 1;
  while (end > start && SEPARATOR.test(text[end - 1] ?? "")) end -= 1;
  return text.slice(start, end);
}

/** Failure code to message key, spelled out so a key missing from en.json fails the build. */
const ORCID_ERROR_KEYS = {
  INVALID_ID: "errOrcidINVALID_ID",
  NOT_FOUND: "errOrcidNOT_FOUND",
  UNAVAILABLE: "errOrcidUNAVAILABLE",
  OFFLINE: "errOffline",
} as const;

/** A failure code, not a message: the lookup runs outside React, so the caller translates it. */
type OrcidFailure = { code: keyof typeof ORCID_ERROR_KEYS };

/** Resolve an ORCID iD to a display name from ORCID's public API, which allows any origin. */
export async function fetchOrcidName(orcid: string): Promise<{ displayName: string } | OrcidFailure> {
  // The one part of the app that needs a network: say offline, don't blame ORCID.
  if (!navigator.onLine) return { code: "OFFLINE" };
  const result = await lookupOrcidPerson(normalizeOrcid(orcid));
  if (!result.ok) {
    // A connection that drops mid-request fails as UNAVAILABLE; say offline.
    return { code: result.code === "UNAVAILABLE" && !navigator.onLine ? "OFFLINE" : result.code };
  }
  return { displayName: result.displayName };
}

/** Render an ORCID failure in the interface language. */
export function orcidErrorText(failure: OrcidFailure, t: ReturnType<typeof useTranslations>): string {
  return t(ORCID_ERROR_KEYS[failure.code]);
}
