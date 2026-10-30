# 4. Optional end-to-end encrypted relay

- Status: proposed
- Date: 2026-10-13
- Relates to: [ADR 0002](0002-no-accounts-or-server-side-storage.md) (no server-side storage of
  draft data) and [ADR 0003](0003-static-export.md) (static export, no Worker code)

## Context

Collecting roles from co-authors is a link round trip: the lead copies an ask link, the co-author
copies a reply link back, and the lead opens it. Since v0.7.0 the reply is kept beside the lead's row
and settled in the Review tab, but the copy and paste remain. Live co-editing of one draft is not
possible at all.

[ADR 0002](0002-no-accounts-or-server-side-storage.md) chose this on purpose. It says to revisit only
when both of its conditions hold:

1. **People who are not the maintainer ask for it.** This does not hold yet. Nobody but the maintainer
   has asked for replies without copy-paste or for live editing.
2. **Someone carries the operational and data-protection burden** of storing third-party personal
   data. This holds in part. The maintainer is willing to run a small relay. The design below keeps the
   data-protection burden small, because the server never holds readable draft data. It does not make
   that burden zero (see "What the server still sees").

So this ADR does not reopen ADR 0002. It proposes a design for when condition 1 is met, or for the
maintainer's own use before then. The link round trip stays the default.

The research behind it is dated 2026-10-08. Versions and maturity claims below are as of that date.

## Decision

Add an **optional relay that stores and forwards ciphertext only**. A user opts in per draft. Without
opting in, nothing changes.

- **Server.** One Cloudflare Durable Object (DO) per shared draft, in its own Worker, so the static site
  keeps running with no Worker code. The DO stores opaque blobs and forwards them to connected clients.
  It never decrypts, parses or merges them. It uses the WebSocket Hibernation API, so idle connections
  cost no duration charges.
- **Encryption.** AES-GCM through WebCrypto, with a fresh random nonce per message. XChaCha20-Poly1305
  (libsodium) is the fallback if nonce handling becomes awkward, at the cost of a dependency. Each
  message carries a format version.
- **Key.** One random symmetric key per shared draft, in the URL fragment. Browsers do not send the
  fragment to the server. The app must also keep it out of `Referer`, logs and analytics.
- **Presence** (who is online, which cell they are on) is encrypted under the same key.
- **Expiry.** A DO alarm deletes stored blobs 14 days after the last write. The relay is a mailbox, not
  storage: the draft of record stays in each browser.
- **Replies first.** *Send back* posts the encrypted reply to the relay, and the lead's app receives it.
  The relay sits behind a transport port with a Durable Object adapter and an in-memory adapter for
  tests. A received reply is decrypted in the browser and handed to `askStep` as a `reply` event, with
  `sentAt` taken from inside the encrypted message, never from the server.
- **Live co-editing later.** The draft becomes a Yjs document over the same relay, persisted locally in
  IndexedDB. Clients encrypt each update and upload encrypted snapshots, following the design of
  [secsync](https://github.com/nikgraf/secsync) without depending on its package, which has had no
  release since June 2024. We do not use y-partyserver's `YServer`: it keeps a readable `Y.Doc` on the
  server.

### What the server still sees

Encryption hides the content, not the metadata. The relay sees draft ids, which connections belong to
which draft, when messages arrive, how large they are, how many people are connected, and their IP
addresses. Cloudflare sees the same. Anyone with the link holds the key.

### Removing a co-author

There is no per-person key, so removal means rotation. The lead's app makes a new key, uploads a new
snapshot under it, shares a new link with the remaining co-authors, and the relay deletes the old
blobs. A removed person keeps everything they already read. Rotation stops future access only.

### Offline and conflicts

Replies are single messages: one waits in the DO until the lead's app connects, or until it expires.
For live editing, Yjs merges concurrent edits without conflicts, and offline edits merge on reconnect.
Clients upload a new snapshot from time to time, because the server cannot compact an update log it
cannot read. A client that was offline across a rotation holds updates under the old key. If it still
has the new link, it re-encrypts them before uploading. If not, they stay local.

## Options considered

- **Keyhive with Beelay or Subduction (Ink & Switch).** The right long-term shape, with per-member keys
  and real revocation. Both carry a "DO NOT use in production" warning as of October 2026.
- **Jazz.** Built-in encryption with key rotation on removal, but mid-rewrite: 0.20.x is "classic" and
  Jazz 2 is in alpha.
- **MLS (RFC 9420, for example ts-mls).** Gives forward secrecy and post-compromise security, but needs
  per-user identities, key packages and an ordered delivery service. Too much for 2 to 20 co-authors
  who share one link.
- **Automerge 3 or Loro.** Stable and maintained, but each ships a WASM payload of 1 to 2 MB, against
  pure-JS Yjs. They have less prior art for encrypted relays.
- **Keep the link round trip only.** Still the default, and still enough for everyone who has used the
  app so far.

## Consequences

**Good**

- Replies arrive without copy-paste, and live co-editing becomes possible.
- The relay never holds readable draft data, so a breach or subpoena of it yields ciphertext and
  metadata.
- The default path is unchanged. A lab that self-hosts can leave the relay out.

**Trade-offs**

- **Operational burden.** A Worker, a DO, alarms, deploys and monitoring to keep alive, for one
  maintainer. ADR 0003 removed Worker code from the site to stop production failures. This brings
  Worker code back, kept in a separate Worker.
- **Cost.** The Workers Free plan allows DOs (SQLite-backed only) with 100,000 requests and 13,000 GB-s
  per day, 5M row reads and 100,000 row writes per day, and 5 GB stored. Incoming WebSocket messages
  count at 20 to 1. At 2 to 20 co-authors per draft this should fit for a hobby or academic tool. Past
  that, the Paid plan includes 1M requests and 400,000 GB-s per month, then $0.15 per million requests.
- **A server dependency** for an otherwise static app. If the relay is down, shared drafts fall back to
  the link round trip.
- **The privacy claim changes.** "Nothing on a server" becomes "nothing readable on a server". The
  README must say so before the relay ships, and ADR 0002's status line would then note that this ADR
  amends it. Whether stored ciphertext counts as
  personal data for an operator without the key is not settled. Short expiry keeps the exposure small
  either way.
- **Link leaks are permanent.** Browser history and link-preview bots can capture the key, and
  rotation cannot undo what was read.
- **Crypto code to own.** No audited package does this for Yjs, so the encryption layer is ours to get
  right.

## Accept or reject

Accept when people who are not the maintainer ask for replies without copy-paste or for live editing,
or when the maintainer's own use justifies the burden, and when tests show the relay never receives
plaintext and that blobs expire.

Reject, or keep proposed, if the free plan does not cover real use, if the encryption layer cannot be
reviewed by someone besides its author, or if the link round trip turns out to be enough. Revisit the
options above when Keyhive and Subduction drop their production warnings or Jazz 2 is stable.
