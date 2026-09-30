# 2. No accounts or server-side storage

- Status: accepted; the lookup proxies it mentions are removed by [ADR 0003](0003-static-export.md)
- Date: 2026-08-26

## Context

[ADR 0001](0001-client-side-architecture.md) chose a client-side architecture,
resting on the assertion that the app has "no user account, no shared state
between users, and nothing worth persisting on a server". Two pieces of planned
work put pressure on that assertion:

- **Multiple drafts.** The store persists one draft, so starting a second paper
  destroys the first. Anyone who writes more than one paper a year hits this.
- **Collecting roles from co-authors.** The slow part of a CRediT statement is
  asking twelve people what they did. A server would turn "send a link, they
  send it back, you paste it" into "send a link, their answer appears".

Both are real. Neither is what ADR 0001 anticipated, so the decision was
revisited rather than assumed.

Accounts would also buy cross-device access and durability against a browser
clearing its site data.

## Decision

Keep the app account-free, with **no server-side storage of draft data**. The
one server-side surface stays what ADR 0001 described: stateless proxies to
public APIs that send no browser-friendly CORS headers, now ORCID and Crossref.

Multiple drafts are solved locally: a map of drafts in `localStorage` behind a
picker. Co-author collection is solved with a claimed share link that carries
the draft in its fragment and comes back the same way.

## Rationale

The deciding argument is not cost or effort. ORCID OAuth suits this audience
and an edge database is readily available. It is what the data *is*.

A stored draft holds the names and ORCID iDs of **third parties who never
visited the site**. Storing those server-side means processing personal data of
identifiable people who gave no consent. That brings a lawful basis, a
retention policy, a privacy notice, and deletion requests. These obligations are
permanent, for a free tool with one maintainer. Today the honest answer to
"what do you keep about my co-authors" is *nothing; it is in their browser*.
That answer is worth more than the convenience it costs.

Two further points:

- Sync would undo the offline guarantee. Offline plus a server means conflict
  resolution, and "it just works on a plane" stops being true.
- Durability matters less than it looks. This is a drafting tool: a session is
  minutes, and the artifact of record is the manuscript, not the app's state.
  Losing a draft costs a re-import from the DOI.

## Consequences

**Good**

- The privacy claim stays absolute and needs no policy document to explain.
- The app remains installable, offline-capable, and deployable by any lab that
  wants its own copy, with no operational burden on the maintainer.
- No auth, no database, no sync, and no conflict resolution to build or secure.

**Trade-offs**

- Collecting roles from co-authors stays a manual round trip: each person
  returns a link that the corresponding author pastes back in.
- Drafts are per-browser. Moving between devices means exporting JSON and
  importing it on the other side.
- Clearing site data destroys unexported drafts, with no recovery path.
- Draft size stays bounded by what fits in a URL fragment and in
  `localStorage`.

## Revisit when

Both of these are true, not either one:

1. People who are not the maintainer ask for cross-device drafts or complain
   that the link round trip is too fiddly in real use.
2. Someone is willing to carry the operational and data-protection burden that
   storing third-party personal data creates.
