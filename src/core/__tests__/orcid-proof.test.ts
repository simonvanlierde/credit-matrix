import { describe, expect, it, vi } from "vitest";
import { applyPatch, askStep } from "../ask";
import { fromJson, toJson } from "../export/json";
import {
  fetchOrcidKeys,
  ORCID_CLIENT_ID,
  orcidSignInUrl,
  replyNonce,
  verifyOrcidToken,
  verifyReplyProof,
} from "../orcid-proof";
import { createAuthor } from "../parse-authors";
import { decodeShareHash, encodeShareHash, toBase64Url } from "../share-link";
import { type SharePayloadInput, toSharePayload } from "../share-payload";
import { TEST_ORCID as ORCID, testIssuer } from "./orcid-test-issuer";

const NOW = Date.UTC(2026, 9, 18, 12);
const issuer = testIssuer(NOW);
const signToken: Awaited<typeof issuer>["sign"] = async (claims, header) => (await issuer).sign(claims, header);
const encode = (value: unknown) => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

function replyInput(): SharePayloadInput {
  const bob = createAuthor("Bob White", { id: "bob", contributions: [{ role: "Investigation", score: 100 }] });
  return { authors: [bob], claimId: "bob", sourceDraftId: "draft-1", reply: true, sentAt: NOW };
}

describe("ORCID sign-in on a reply", () => {
  it("builds ORCID's implicit-flow sign-in URL with the reply's nonce", () => {
    const url = new URL(orcidSignInUrl({ redirectUri: "https://credit.duinlab.nl/", nonce: "abc", state: "xyz" }));
    expect(url.origin + url.pathname).toBe("https://orcid.org/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: ORCID_CLIENT_ID,
      response_type: "token",
      scope: "openid",
      redirect_uri: "https://credit.duinlab.nl/",
      nonce: "abc",
      state: "xyz",
    });
  });

  it("accepts a token ORCID signed for this app and this reply", async () => {
    const { keys } = await issuer;
    const payload = toSharePayload(replyInput());
    const nonce = await replyNonce(payload);
    const token = await signToken({ nonce });
    expect(await verifyOrcidToken(token, { nonce, keys, payload, now: NOW })).toEqual({
      orcid: ORCID,
      name: "Bob White",
      issuedAt: NOW - 30_000,
      token,
      payload,
    });
  });

  it("refuses a token with the wrong signer, issuer, audience, nonce, key id, or shape", async () => {
    const { keys } = await issuer;
    const nonce = "n";
    const check = (token: string) => verifyOrcidToken(token, { nonce, keys, payload: "", now: NOW });
    const other = await testIssuer(NOW);
    expect(await verifyOrcidToken(await signToken({ nonce }), { nonce, keys: other.keys, payload: "" })).toBeNull();
    expect(await check(await signToken({ nonce, iss: "https://sandbox.orcid.org" }))).toBeNull();
    expect(await check(await signToken({ nonce, aud: "APP-SOMEONEELSE000" }))).toBeNull();
    expect(await check(await signToken({ nonce: "other" }))).toBeNull();
    expect(await check(await signToken({ nonce, sub: "not-an-orcid" }))).toBeNull();
    expect(await check(await signToken({ nonce }, { kid: "rotated" }))).toBeNull();
    expect(await check(await signToken({ nonce }, { alg: "none" }))).toBeNull();
    expect(await check("not.a.token")).toBeNull();
    expect(await check("a.b.c.d")).toBeNull();
    // A body swapped under a valid signature.
    const [head, , signature] = (await signToken({ nonce })).split(".");
    expect(await check(`${head}.${encode({ iss: "https://orcid.org", nonce })}.${signature}`)).toBeNull();
    // An audience list naming this app is fine.
    expect(await check(await signToken({ nonce, aud: [ORCID_CLIENT_ID] }))).not.toBeNull();
    // A subject in URL form reads as the bare iD.
    expect(await check(await signToken({ nonce, sub: `https://orcid.org/${ORCID}` }))).toMatchObject({ orcid: ORCID });
  });

  it("checks expiry only when given the time: the lead reads the reply after the token expired", async () => {
    const { keys } = await issuer;
    const token = await signToken({ nonce: "n" });
    const later = NOW + 24 * 3600 * 1000;
    expect(await verifyOrcidToken(token, { nonce: "n", keys, payload: "", now: later })).toBeNull();
    expect(await verifyOrcidToken(token, { nonce: "n", keys, payload: "" })).not.toBeNull();
    // Issued in the future, beyond the allowed drift.
    expect(await verifyOrcidToken(token, { nonce: "n", keys, payload: "", now: NOW - 10 * 60_000 })).toBeNull();
  });

  it("carries the token in the reply link, bound to that link's answer", async () => {
    const { keys } = await issuer;
    const input = replyInput();
    const nonce = await replyNonce(toSharePayload(input));
    const token = await signToken({ nonce });
    const url = await encodeShareHash({ ...input, idToken: token }, "https://credit.duinlab.nl/");
    // A token barely compresses: it adds about its own length to the link, under 1 kB.
    const unsigned = await encodeShareHash(input, "https://credit.duinlab.nl/");
    expect(url.length - unsigned.length).toBeLessThan(1000);
    const shared = await decodeShareHash(url.slice(url.indexOf("#")));
    expect(shared?.signIn?.token).toBe(token);
    expect(shared?.signIn && (await verifyReplyProof(shared.signIn, keys))).toMatchObject({ orcid: ORCID });

    // The same token on a different answer does not verify.
    const changed = replyInput();
    (changed.authors[0] as (typeof changed.authors)[0]).contributions = [{ role: "Software", score: 100 }];
    const lifted = await encodeShareHash({ ...changed, idToken: token });
    const moved = await decodeShareHash(lifted.slice(lifted.indexOf("#")));
    expect(moved?.signIn && (await verifyReplyProof(moved.signIn, keys))).toBeNull();
  });

  it("keeps the token off anything but a reply, and links without one read as unsigned", async () => {
    const { reply: _reply, ...ask } = replyInput();
    expect(toSharePayload({ ...ask, idToken: "t" })).not.toContain('"k"');
    const url = await encodeShareHash(replyInput());
    expect((await decodeShareHash(url.slice(url.indexOf("#"))))?.signIn).toBeNull();
  });

  it("fetches ORCID's keys, and returns null when it cannot", async () => {
    const { keys } = await issuer;
    const ok = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ keys }), { status: 200 }));
    expect(await fetchOrcidKeys(ok)).toEqual(keys);
    expect(ok.mock.calls[0]?.[0]).toBe("https://orcid.org/oauth/jwks");
    const down = vi.fn<typeof fetch>().mockRejectedValue(new Error("offline"));
    expect(await fetchOrcidKeys(down)).toBeNull();
    const junk = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ keys: "no" }), { status: 200 }));
    expect(await fetchOrcidKeys(junk)).toBeNull();
  });
});

describe("a signed reply in the ask record", () => {
  const lead = () => [createAuthor("Bob White", { id: "bob", contributions: [{ role: "Software", score: 100 }] })];
  const row = () => replyInput().authors[0];

  async function proof() {
    const payload = toSharePayload(replyInput());
    return {
      orcid: ORCID,
      name: "Bob White",
      issuedAt: NOW,
      token: await signToken({ nonce: await replyNonce(payload) }),
      payload,
    };
  }

  it("keeps the sign-in beside the answer, and a later sign-in of the same answer replaces an unsigned one", async () => {
    const orcid = await proof();
    const state = { authors: lead(), asks: {} };
    const unsigned = askStep(state, { kind: "reply", contributorId: "bob", row: row(), sentAt: NOW, at: NOW + 1 });
    const held = applyPatch(state, unsigned.patch);
    expect(held.asks.bob?.reply?.provenance).toBeUndefined();

    const signed = askStep(held, { kind: "reply", contributorId: "bob", row: row(), sentAt: NOW, at: NOW + 2, orcid });
    expect(signed.outcome).toMatchObject({ kind: "received", duplicate: false });
    const after = applyPatch(held, signed.patch);
    expect(after.asks.bob?.reply?.provenance).toEqual({ orcid });

    // The same signed link again is a duplicate.
    const again = askStep(after, { kind: "reply", contributorId: "bob", row: row(), sentAt: NOW, at: NOW + 3, orcid });
    expect(again.outcome).toMatchObject({ duplicate: true });
  });

  it("survives a JSON export and import, and a malformed one is dropped without the answer", async () => {
    const orcid = await proof();
    const state = { authors: lead(), asks: {} };
    const step = askStep(state, { kind: "reply", contributorId: "bob", row: row(), sentAt: NOW, at: NOW + 1, orcid });
    const { authors, asks } = applyPatch(state, step.patch);
    const back = fromJson(toJson([...authors], { asks }));
    expect(back.asks?.bob?.reply?.provenance).toEqual({ orcid });

    const file = JSON.parse(toJson([...authors], { asks }));
    file.asks.bob.reply.provenance = { orcid: { orcid: "nope" } };
    const broken = fromJson(JSON.stringify(file));
    expect(broken.asks?.bob?.reply).toBeDefined();
    expect(broken.asks?.bob?.reply?.provenance).toBeUndefined();
  });
});
