# 2. No accounts or server-side storage

- Status: accepted; the lookup proxies it mentions are removed by [ADR 0003](0003-static-export.md)
- Date: 2026-08-26

## Context

[ADR 0001](0001-client-side-architecture.md) chose to run everything in the
browser. It rested on the claim that the app has "no user account, no shared
state between users, and nothing worth persisting on a server". Two pieces of
planned work put that claim to the test:

- **Multiple drafts.** The store saves one draft, so starting a second paper
  wipes out the first. Anyone who writes more than one paper a year runs into
  this.
- **Collecting roles from co-authors.** The slow part of a CRediT statement is
  asking twelve people what they did. A server would turn "send a link, they
  send it back, you paste it" into "send a link, their answer appears".

ADR 0001 didn't foresee either. Accounts would also give access from any
device, and keep drafts safe when a browser clears its site data.

## Decision

Keep the app free of accounts, with **no draft data stored on a server**. The
only server code stays what ADR 0001 described: proxies that keep no state, for
public APIs that send no CORS headers a browser accepts. Those are now ORCID
and Crossref.

Multiple drafts are handled in the browser: a map of drafts in `localStorage`,
with a picker. Asking co-authors works with a share link addressed to one
person. It carries the draft in its fragment (the part after `#`) and comes
back the same way.

## Rationale

Not cost or effort: ORCID OAuth suits these users, and an edge database is
easy to get. What decides it is what the data *is*.

A stored draft holds the names and ORCID iDs of **other people who never
visited the site**. Storing those on a server means processing personal data of
people who can be identified and who never agreed to it. That needs a legal
basis, a retention policy, a privacy notice, and handling deletion requests.
Those duties never end, and this is a free tool with one maintainer. Today the
honest answer to "what do you keep about my co-authors" is *nothing; it is in
their browser*. That answer is worth more than the convenience it costs.

Two more points:

- Syncing would break working offline. Offline plus a server means resolving
  conflicts, and "it just works on a plane" stops being true.
- Losing a draft matters less than it looks. This is a drafting tool: a session
  takes minutes, and the record that counts is the manuscript, not the app's
  state. Losing a draft costs a new import from the DOI.

## Consequences

**Good**

- The privacy claim has no exceptions, and needs no policy document to explain.
- The app can still be installed, used offline, and deployed by any lab that
  wants its own copy, and none of that is work for the maintainer.
- There is no login, database, sync, or conflict resolution to build or secure.

**Trade-offs**

- Collecting roles from co-authors stays a manual round trip. Each person
  sends back a link, and the corresponding author pastes it in.
  - Note, 2026-10-13: still a manual link round trip, but opening a reply no
    longer pastes it over the row. The co-author's answer is kept beside the
    corresponding author's row, and each difference is settled in the Review
    tab. The decision above is unchanged.
- Drafts live in one browser. To move to another device, you export JSON and
  import it there.
- Clearing site data deletes drafts you haven't exported, and they can't be
  recovered.
- A draft can't grow beyond what fits in a URL fragment and in `localStorage`.

## Revisit when

Both of these have to be true, not just one:

1. People who are not the maintainer ask for cross-device drafts or complain
   that the link round trip is too fiddly in real use.
2. Someone is willing to take on running a server and the data-protection
   duties that come with storing other people's personal data.
