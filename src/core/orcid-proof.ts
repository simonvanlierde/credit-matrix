import * as z from "zod/mini";
import { normalizeOrcid, ORCID_INPUT_REGEX, ORCID_REGEX } from "./author";
import { fromBase64Url, toBase64Url } from "./share-link";
import { fetchUpstreamJson } from "./upstream-fetch";

/**
 * ORCID sign-in for a co-author's reply, with no server of ours in between.
 *
 * The co-author signs in with ORCID's OpenID Connect implicit flow. The
 * `nonce` sent to ORCID is the SHA-256 of the reply link's payload, so the
 * `id_token` ORCID signs names that exact answer and cannot be moved onto
 * another. The token then travels inside the reply link.
 *
 * What "verified" means: ORCID's signature over the token checks out against
 * ORCID's published keys, the token was issued by ORCID for this app, and its
 * nonce is the hash of the reply it came with. Expiry is checked only where
 * the co-author signs in: the token lives ten minutes, and the lead reads the
 * reply long after. The lead is shown when the sign-in happened instead.
 */

export const ORCID_ISSUER = "https://orcid.org";
/** The app's public ORCID API client. Public by design: the implicit flow has no secret. */
export const ORCID_CLIENT_ID = "APP-B590D3O2BVA2FFUY";
const AUTHORIZE_URL = `${ORCID_ISSUER}/oauth/authorize`;
const JWKS_URL = `${ORCID_ISSUER}/oauth/jwks`;
/** Clock drift allowed on the co-author's side, in milliseconds. */
const SKEW_MS = 60_000;

/** What a verified reply keeps: who signed in, and the evidence to check it again. */
export const OrcidProofSchema = /* @__PURE__ */ (() =>
  z.looseObject({
    /** The signed-in ORCID iD (the token's `sub`). */
    orcid: z.string().check(z.regex(ORCID_REGEX)),
    /** The name on the ORCID record, when the record shares it. */
    name: z.optional(z.string()),
    /** When the co-author signed in, in epoch milliseconds (the token's `iat`). */
    issuedAt: z.number(),
    /** The `id_token` as ORCID issued it. */
    token: z.string(),
    /** The reply link's payload the token's nonce hashes, so the binding can be checked again. */
    payload: z.string(),
  }))();
export type OrcidProof = z.infer<typeof OrcidProofSchema>;

const KeySetSchema = /* @__PURE__ */ (() =>
  z.object({
    keys: z.array(z.looseObject({ kty: z.string(), kid: z.optional(z.string()) })),
  }))();
/** One RSA key from ORCID's JWKS, as much of it as this reads. */
export type OrcidKey = { kty: string; kid?: string; n?: string; e?: string };

const HeaderSchema = /* @__PURE__ */ (() => z.object({ alg: z.literal("RS256"), kid: z.optional(z.string()) }))();
const ClaimsSchema = /* @__PURE__ */ (() =>
  z.object({
    iss: z.literal(ORCID_ISSUER),
    aud: z.union([z.string(), z.array(z.string())]),
    sub: z.string().check(z.regex(ORCID_INPUT_REGEX)),
    nonce: z.string(),
    iat: z.number(),
    exp: z.number(),
    given_name: z.optional(z.string()),
    family_name: z.optional(z.string()),
  }))();

/** The nonce for a reply: base64url SHA-256 of its link payload. */
export async function replyNonce(payload: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return toBase64Url(new Uint8Array(digest));
}

/** ORCID's sign-in page for this reply. ORCID sends the browser back to `redirectUri` with the token in the fragment. */
export function orcidSignInUrl({ redirectUri, nonce, state }: { redirectUri: string; nonce: string; state: string }) {
  const params = new URLSearchParams({
    client_id: ORCID_CLIENT_ID,
    // ORCID's implicit flow: the token response carries the id_token when the scope is openid.
    response_type: "token",
    scope: "openid",
    redirect_uri: redirectUri,
    nonce,
    state,
  });
  return `${AUTHORIZE_URL}?${params}`;
}

/** ORCID's signing keys. Null when ORCID cannot be reached or answers with something else. */
export async function fetchOrcidKeys(fetcher: typeof fetch = fetch): Promise<OrcidKey[] | null> {
  const upstream = await fetchUpstreamJson(JWKS_URL, fetcher);
  if (upstream.kind !== "ok") return null;
  const parsed = KeySetSchema.safeParse(upstream.body);
  return parsed.success ? (parsed.data.keys as OrcidKey[]) : null;
}

const decodeJson = (part: string): unknown => JSON.parse(new TextDecoder().decode(fromBase64Url(part)));

/**
 * Check an ORCID `id_token` against `keys` and the expected nonce. Returns the
 * proof, or null when anything fails. With `now`, an expired token fails too;
 * without it, expiry is not checked (see the module comment).
 */
export async function verifyOrcidToken(
  token: string,
  { nonce, keys, payload, now }: { nonce: string; keys: readonly OrcidKey[]; payload: string; now?: number },
): Promise<OrcidProof | null> {
  try {
    const [head, body, signature, ...rest] = token.split(".");
    if (!(head && body && signature) || rest.length > 0) return null;
    const header = HeaderSchema.parse(decodeJson(head));
    // Without a `kid`, any of ORCID's keys may have signed it: try each.
    const candidates = keys.filter(
      (candidate) => candidate.kty === "RSA" && (header.kid === undefined || candidate.kid === header.kid),
    );
    const signed = new TextEncoder().encode(`${head}.${body}`);
    const bytes = fromBase64Url(signature) as Uint8Array<ArrayBuffer>;
    let valid = false;
    for (const jwk of candidates) {
      const key = await crypto.subtle.importKey(
        "jwk",
        { kty: "RSA", n: jwk.n, e: jwk.e },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      );
      valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, bytes, signed);
      if (valid) break;
    }
    if (!valid) return null;

    const claims = ClaimsSchema.parse(decodeJson(body));
    const audience = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
    if (!audience.includes(ORCID_CLIENT_ID) || claims.nonce !== nonce) return null;
    if (now !== undefined && (claims.exp * 1000 + SKEW_MS < now || claims.iat * 1000 - SKEW_MS > now)) return null;
    const name = [claims.given_name, claims.family_name].filter(Boolean).join(" ");
    return {
      orcid: normalizeOrcid(claims.sub),
      ...(name ? { name } : {}),
      issuedAt: claims.iat * 1000,
      token,
      payload,
    };
  } catch {
    return null;
  }
}

/** Verify a reply link's token: its nonce must be the hash of the payload it travelled in. */
export async function verifyReplyProof(
  proof: { token: string; payload: string },
  keys: readonly OrcidKey[],
): Promise<OrcidProof | null> {
  return verifyOrcidToken(proof.token, { nonce: await replyNonce(proof.payload), keys, payload: proof.payload });
}
