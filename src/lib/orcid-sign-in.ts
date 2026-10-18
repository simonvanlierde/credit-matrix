import type { ShareData, SharePayloadInput } from "@/core";
import { fetchOrcidKeys, type OrcidProof, orcidSignInUrl, replyNonce, verifyOrcidToken } from "@/core/orcid-proof";
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
  payload: string;
  /** The reply's `w`, so the page can rebuild the exact payload ORCID signed. */
  sentAt: number;
}

/** Send the co-author to ORCID to sign this reply. False when the tab cannot keep the pending sign-in. */
export async function startOrcidSignIn(reply: SharePayloadInput & { sentAt: number }): Promise<boolean> {
  const payload = toSharePayload(reply);
  const pending: Pending = { state: crypto.randomUUID(), payload, sentAt: reply.sentAt };
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    return false;
  }
  // ORCID only returns to a registered address: the production page. Elsewhere sign-in fails at ORCID.
  const { origin, pathname } = window.location;
  const nonce = await replyNonce(payload);
  window.location.assign(orcidSignInUrl({ redirectUri: `${origin}${pathname}`, nonce, state: pending.state }));
  return true;
}

/** Whether a URL fragment is ORCID sending the browser back. */
export function isOrcidReturn(hash: string): boolean {
  const params = new URLSearchParams(hash.slice(1));
  return params.has("id_token") || params.has("access_token") || params.has("error");
}

/**
 * Clear ORCID's answer from the address bar and history, and the pending
 * sign-in from the tab, and return both. For a page that cannot use the
 * answer, it is the whole job: the tokens must not stay behind.
 */
export function discardOrcidReturn(): { params: URLSearchParams; pending: Pending | null } {
  const params = new URLSearchParams(window.location.hash.slice(1));
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
  let pending: Pending | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // No storage, no pending sign-in.
  }
  return { params, pending };
}

/**
 * Read ORCID's answer from the address bar, if this page load is one, and
 * clear it (see `discardOrcidReturn`). Null when it is not; `null` proof when
 * the sign-in was cancelled or does not check out. `sentAt` is the signed
 * reply's `w`.
 */
export async function takeOrcidReturn(
  fetcher: typeof fetch = fetch,
): Promise<{ proof: OrcidProof; sentAt: number } | { proof: null } | null> {
  if (!isOrcidReturn(window.location.hash)) return null;
  const { params, pending } = discardOrcidReturn();
  const token = params.get("id_token");
  if (!(pending && token) || params.get("state") !== pending.state) return { proof: null };
  const keys = await fetchOrcidKeys(fetcher);
  const proof = keys && (await verifyOrcidToken(token, { payload: pending.payload, keys, now: Date.now() }));
  return proof ? { proof, sentAt: pending.sentAt } : { proof: null };
}

/** Check the sign-in a reply link carries. Undefined when it has none, or it does not check out. */
export async function verifyIncoming(
  shared: ShareData,
  fetcher: typeof fetch = fetch,
): Promise<OrcidProof | undefined> {
  if (!shared.signIn) return undefined;
  const keys = await fetchOrcidKeys(fetcher);
  return (keys && (await verifyOrcidToken(shared.signIn.token, { payload: shared.signIn.payload, keys }))) || undefined;
}
