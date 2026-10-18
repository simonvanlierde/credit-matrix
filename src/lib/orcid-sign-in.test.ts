import { afterEach, describe, expect, it, vi } from "vitest";
import { TEST_ORCID, testIssuer } from "@/core/__tests__/orcid-test-issuer";
import { replyNonce } from "@/core/orcid-proof";
import { createAuthor } from "@/core/parse-authors";
import { decodeShareHash, encodeShareHash } from "@/core/share-link";
import { type SharePayloadInput, toSharePayload } from "@/core/share-payload";
import { discardOrcidReturn, startOrcidSignIn, takeOrcidReturn, verifyIncoming } from "./orcid-sign-in";

const reply = (): SharePayloadInput & { sentAt: number } => ({
  authors: [createAuthor("Bob White", { id: "bob" })],
  claimId: "bob",
  sourceDraftId: "draft-1",
  reply: true,
  sentAt: 5,
});
const jwks = (keys: unknown) =>
  vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ keys }), { status: 200 }));
const pending = () => JSON.parse(sessionStorage.getItem("credit-matrix:orcid-sign-in") ?? "null");

afterEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("ORCID sign-in in the browser", () => {
  it("ignores a page load that is not ORCID's return", async () => {
    window.history.replaceState(null, "", "/#s=abc");
    expect(await takeOrcidReturn(jwks([]))).toBeNull();
    expect(window.location.hash).toBe("#s=abc");
  });

  it("takes the signed answer back from ORCID and clears the token from the address bar", async () => {
    const { keys, sign } = await testIssuer();
    // jsdom does not navigate; the pending sign-in is what matters.
    await startOrcidSignIn(reply());
    const { state, nonce, payload } = pending();
    expect(payload).toBe(toSharePayload(reply()));
    expect(nonce).toBe(await replyNonce(payload));

    const token = await sign({ nonce });
    window.history.replaceState(null, "", `/?x=1#access_token=a&token_type=bearer&id_token=${token}&state=${state}`);
    const result = await takeOrcidReturn(jwks(keys));
    expect(result?.proof).toMatchObject({ orcid: TEST_ORCID, name: "Bob White", token, payload });
    expect(result).toMatchObject({ sentAt: 5 });
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe("?x=1");
    expect(pending()).toBeNull();
  });

  it("refuses a token that expired before it came back", async () => {
    const { keys, sign } = await testIssuer(Date.now() - 24 * 3600 * 1000);
    await startOrcidSignIn(reply());
    const { state, nonce } = pending();
    window.history.replaceState(null, "", `/#id_token=${await sign({ nonce })}&state=${state}`);
    expect(await takeOrcidReturn(jwks(keys))).toEqual({ proof: null });
  });

  it("discards a return no page can use: the tokens leave the address bar and the pending sign-in goes", async () => {
    await startOrcidSignIn(reply());
    window.history.replaceState(null, "", "/?x=1#access_token=a&id_token=b.c.d&state=s");
    discardOrcidReturn();
    expect(window.location.href).not.toContain("token");
    expect(window.location.search).toBe("?x=1");
    expect(pending()).toBeNull();
  });

  it("fails a cancelled sign-in, a foreign state, or no pending sign-in", async () => {
    const { keys, sign } = await testIssuer();
    window.history.replaceState(null, "", "/#error=access_denied");
    expect(await takeOrcidReturn(jwks(keys))).toEqual({ proof: null });

    await startOrcidSignIn(reply());
    const token = await sign({ nonce: pending().nonce });
    window.history.replaceState(null, "", `/#id_token=${token}&state=someone-else`);
    expect(await takeOrcidReturn(jwks(keys))).toEqual({ proof: null });

    window.history.replaceState(null, "", `/#id_token=${token}&state=x`);
    expect(await takeOrcidReturn(jwks(keys))).toEqual({ proof: null });
  });

  it("verifies a reply link's sign-in, and leaves an unsigned or unreachable one unverified", async () => {
    const { keys, sign } = await testIssuer();
    const token = await sign({ nonce: await replyNonce(toSharePayload(reply())) });
    const url = await encodeShareHash({ ...reply(), idToken: token });
    const shared = await decodeShareHash(url.slice(url.indexOf("#")));
    if (!shared) throw new Error("expected a link");
    expect(await verifyIncoming(shared, jwks(keys))).toMatchObject({ orcid: TEST_ORCID });
    expect(await verifyIncoming(shared, vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")))).toBeUndefined();
    const fetcher = jwks(keys);
    expect(await verifyIncoming({ ...shared, signIn: null }, fetcher)).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
