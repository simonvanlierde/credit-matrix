import type { ShareData, SharePayloadInput } from "@/core";
import {
  fetchOrcidKeys,
  type OrcidProof,
  orcidSignInUrl,
  replyNonce,
  verifyOrcidToken,
  verifyReplyProof,
} from "@/core/orcid-proof";
import { toSharePayload } from "@/core/share-payload";

/**
 * The browser side of a co-author's ORCID sign-in (see `core/orcid-proof.ts`).
 * ORCID sends the browser back to this page with the token in the fragment;
 * what the page needs to pick up where it left off waits in sessionStorage,
 * which never leaves this tab.
 */
const PENDING_KEY = "credit-matrix:orcid-sign-in";

interface Pending {
  state: string;
  nonce: string;
  payload: string;
}

/** Send the co-author to ORCID to sign this reply. False when the tab cannot keep the pending sign-in. */
export async function startOrcidSignIn(reply: SharePayloadInput): Promise<boolean> {
  const payload = toSharePayload(reply);
  const pending: Pending = { state: crypto.randomUUID(), nonce: await replyNonce(payload), payload };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    return false;
  }
  // ORCID only returns to a registered address: the production page. Elsewhere sign-in fails at ORCID.
  const { origin, pathname } = window.location;
  window.location.assign(
    orcidSignInUrl({ redirectUri: `${origin}${pathname}`, nonce: pending.nonce, state: pending.state }),
  );
  return true;
}

/**
 * Read ORCID's answer from the address bar, if this page load is one, and
 * clear it from the address bar and history. Null when it is not; `null`
 * proof when the sign-in was cancelled or does not check out.
 */
export async function takeOrcidReturn(fetcher: typeof fetch = fetch): Promise<{ proof: OrcidProof | null } | null> {
  const params = new URLSearchParams(window.location.hash.slice(1));
  if (!(params.has("id_token") || params.has("access_token") || params.has("error"))) return null;
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  let pending: Pending | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // No storage, no pending sign-in: handled below.
  }
  const token = params.get("id_token");
  if (!(pending && token) || params.get("state") !== pending.state) return { proof: null };
  const keys = await fetchOrcidKeys(fetcher);
  const proof = keys && (await verifyOrcidToken(token, { ...pending, keys, now: Date.now() }));
  return { proof: proof || null };
}

/** Check the sign-in a reply link carries. Undefined when it has none, or it does not check out. */
export async function verifyIncoming(
  shared: ShareData,
  fetcher: typeof fetch = fetch,
): Promise<OrcidProof | undefined> {
  if (!shared.signIn) return undefined;
  const keys = await fetchOrcidKeys(fetcher);
  return (keys && (await verifyReplyProof(shared.signIn, keys))) || undefined;
}
