import { describe, expect, it, vi } from "vitest";
import { type AskState, applyPatch, askStep, importAnswers, recheckSignIns } from "../ask";
import type { Author } from "../author";
import { fromJson, toJson } from "../export/json";
import { keepKnownIds } from "../merge-row";
import {
  fetchOrcidKeys,
  ORCID_CLIENT_ID,
  type OrcidKey,
  orcidSignInUrl,
  replyNonce,
  verifyOrcidToken,
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
    const token = await signToken({ nonce: await replyNonce(payload) });
    expect(await verifyOrcidToken(token, { payload, keys, now: NOW })).toEqual({
      orcid: ORCID,
      name: "Bob White",
      issuedAt: NOW - 30_000,
      token,
      payload,
    });
  });

  it("refuses a token with the wrong signer, issuer, audience, nonce, key id, or shape", async () => {
    const { keys } = await issuer;
    const nonce = await replyNonce("");
    const check = (token: string) => verifyOrcidToken(token, { payload: "", keys, now: NOW });
    const other = await testIssuer(NOW);
    expect(await verifyOrcidToken(await signToken({ nonce }), { payload: "", keys: other.keys })).toBeNull();
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

  it("checks a token without a key id against each of ORCID's keys", async () => {
    const { keys } = await issuer;
    const other = await testIssuer(NOW);
    const token = await signToken({ nonce: await replyNonce("") }, { kid: undefined });
    const several = [...other.keys, ...keys];
    expect(await verifyOrcidToken(token, { payload: "", keys: several })).toMatchObject({ orcid: ORCID });
    expect(await verifyOrcidToken(token, { payload: "", keys: other.keys })).toBeNull();
  });

  it("checks expiry only when given the time: the lead reads the reply after the token expired", async () => {
    const { keys } = await issuer;
    const token = await signToken({ nonce: await replyNonce("") });
    const later = NOW + 24 * 3600 * 1000;
    expect(await verifyOrcidToken(token, { payload: "", keys, now: later })).toBeNull();
    expect(await verifyOrcidToken(token, { payload: "", keys })).not.toBeNull();
    // Issued in the future, beyond the allowed drift.
    expect(await verifyOrcidToken(token, { payload: "", keys, now: NOW - 10 * 60_000 })).toBeNull();
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
    expect(
      shared?.signIn && (await verifyOrcidToken(shared.signIn.token, { payload: shared.signIn.payload, keys })),
    ).toMatchObject({ orcid: ORCID });

    // The same token on a different answer does not verify.
    const changed = replyInput();
    (changed.authors[0] as (typeof changed.authors)[0]).contributions = [{ role: "Software", score: 100 }];
    const lifted = await encodeShareHash({ ...changed, idToken: token });
    const moved = await decodeShareHash(lifted.slice(lifted.indexOf("#")));
    expect(
      moved?.signIn && (await verifyOrcidToken(moved.signIn.token, { payload: moved.signIn.payload, keys })),
    ).toBeNull();
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

  it("flags a signed reply that changed the row's iD, keeping the iD the ask went to", async () => {
    const orcid = await proof();
    const asked = "0000-0001-5109-3700";
    const state = { authors: [{ ...(lead()[0] as Author), orcid: asked }], asks: {} };
    const changing = { ...row(), orcid: ORCID };
    const step = askStep(state, {
      kind: "reply",
      contributorId: "bob",
      row: changing,
      sentAt: NOW,
      at: NOW + 1,
      orcid,
    });
    expect(applyPatch(state, step.patch).asks.bob?.reply?.provenance).toEqual({ orcid, replacedOrcid: asked });
    // A signed reply that keeps the row's iD flags nothing.
    const keeping = askStep(state, {
      kind: "reply",
      contributorId: "bob",
      row: { ...row(), orcid: asked },
      sentAt: NOW,
      at: NOW + 1,
      orcid,
    });
    expect(applyPatch(state, keeping.patch).asks.bob?.reply?.provenance).toEqual({ orcid });
  });

  it("keeps the iD the ask went to through later replies, signed or not", async () => {
    const orcid = await proof();
    const asked = "0000-0001-5109-3700";
    const start: AskState = { authors: [{ ...(lead()[0] as Author), orcid: asked }], asks: {} };
    const changing = { ...row(), orcid: ORCID };
    const reply = (state: AskState, at: number, answer: unknown, signed: boolean) =>
      applyPatch(
        state,
        askStep(state, {
          kind: "reply",
          contributorId: "bob",
          row: answer,
          sentAt: at,
          at,
          ...(signed ? { orcid } : {}),
        }).patch,
      );

    // A signed reply changes the iD, then a second signed one edits a role.
    const first = reply(start, NOW + 1, changing, true);
    const edited = { ...changing, contributions: [{ role: "Software", score: 100 }] };
    expect(reply(first, NOW + 2, edited, true).asks.bob?.reply?.provenance?.replacedOrcid).toBe(asked);

    // An unsigned reply changes the iD, then the same answer arrives signed.
    const unsigned = reply(start, NOW + 1, changing, false);
    const resigned = reply(unsigned, NOW + 2, changing, true);
    expect(resigned.asks.bob?.reply?.provenance).toEqual({ orcid, replacedOrcid: asked });
  });

  describe("checked again on import", () => {
    async function imported() {
      const orcid = await proof();
      const state = { authors: lead(), asks: {} };
      const step = askStep(state, { kind: "reply", contributorId: "bob", row: row(), sentAt: NOW, at: NOW + 1, orcid });
      const { authors, asks } = applyPatch(state, step.patch);
      return JSON.parse(toJson([...authors], { asks }));
    }
    const keys = async (): Promise<OrcidKey[] | null> => (await issuer).keys;
    const recheck = async (file: unknown, from = keys) =>
      (await recheckSignIns(fromJson(JSON.stringify(file)).asks ?? {}, from)).bob?.reply;

    it("keeps a genuine sign-in", async () => {
      expect((await recheck(await imported()))?.provenance?.orcid).toMatchObject({ orcid: ORCID });
    });

    it("drops a hand-edited iD, name, or token, and keeps the answer", async () => {
      const file = await imported();
      file.asks.bob.reply.provenance.orcid.orcid = "0000-0001-5109-3700";
      file.asks.bob.reply.provenance.orcid.name = "Someone Else";
      // The token's own claims win over the edited fields.
      expect((await recheck(file))?.provenance?.orcid).toMatchObject({ orcid: ORCID, name: "Bob White" });

      file.asks.bob.reply.provenance.orcid.token = await (await testIssuer(NOW)).sign({ nonce: "x" });
      const forged = await recheck(file);
      expect(forged?.provenance).toBeUndefined();
      expect(forged?.contributions).toEqual(row()?.contributions);
    });

    it("keeps a sign-in whose row took a known id on import through the next export", async () => {
      const file = await imported();
      const incoming = fromJson(JSON.stringify(file));
      const asks = await recheckSignIns(incoming.asks ?? {}, keys);
      // The draft already has Bob under another id, so his row takes that one.
      const current = [createAuthor("Bob White", { id: "b2" })];
      const mapped = keepKnownIds(current, incoming.authors);
      expect(mapped[0]?.id).toBe("b2");
      const moved = importAnswers(current, incoming.authors, mapped, {}, { asks }).asks ?? {};
      const again = fromJson(toJson(mapped, { asks: moved }));
      const checked = await recheckSignIns(again.asks ?? {}, keys);
      expect(checked.b2?.reply?.provenance?.orcid).toMatchObject({ orcid: ORCID });
    });

    it("drops a real sign-in moved onto a different answer or another contributor", async () => {
      const changed = await imported();
      changed.asks.bob.reply.contributions = [{ role: "Software", score: 100 }];
      expect((await recheck(changed))?.provenance).toBeUndefined();

      const moved = await imported();
      moved.authors[0].id = "ann";
      moved.asks = { ann: moved.asks.bob };
      expect(
        (await recheckSignIns(fromJson(JSON.stringify(moved)).asks ?? {}, keys)).ann?.reply?.provenance,
      ).toBeUndefined();
    });

    it("keeps a sign-in unchecked when ORCID's keys cannot be fetched, and fetches none when there is nothing to check", async () => {
      const offline = await recheck(await imported(), async () => null);
      expect(offline?.provenance).toMatchObject({ unchecked: true, orcid: { orcid: ORCID } });
      // Checked again once ORCID answers, it counts as verified again.
      const file = JSON.parse(toJson([...lead()], { asks: { bob: { sentAt: NOW, prefilled: true, reply: offline } } }));
      const online = await recheck(file);
      expect(online?.provenance?.orcid).toMatchObject({ orcid: ORCID });
      expect(online?.provenance).not.toHaveProperty("unchecked");
      const fetcher = vi.fn(keys);
      const bare = await imported();
      delete bare.asks.bob.reply.provenance;
      await recheck(bare, fetcher);
      expect(fetcher).not.toHaveBeenCalled();
    });
  });
});
