# Roadmap

What I plan to work on next. It is a plan, not a promise: CRediT Matrix has one maintainer
([GOVERNANCE.md](../GOVERNANCE.md)), and the order changes when users report problems. Each item
links to the issue that tracks it, and shipped changes are in the [changelog](../CHANGELOG.md).

Last reviewed: 2026-11-27

## Now

- **Find the integrations where people look.** The Typst package is on Typst Universe; the Pandoc
  filter waits for its listing ([pandoc-ext/info#8](https://github.com/pandoc-ext/info/pull/8)).
- **A census export anyone can check**: one small, openly licensed export that records its input
  hashes, licence policy and attribution, so a changed input shows up ([#205](https://github.com/simonvanlierde/credit-matrix/issues/205)).

## Next

- **More export formats** that contributorship tools and journal systems read ([#204](https://github.com/simonvanlierde/credit-matrix/issues/204)).
- **Reviewed translations** of the eight machine-made interface languages ([#280](https://github.com/simonvanlierde/credit-matrix/issues/280)).
- **A census beyond Europe PMC**, with Crossref's CRediT deposits as a second source of roles, once
  enough publishers deposit them ([#209](https://github.com/simonvanlierde/credit-matrix/issues/209)).

## Later, or only if asked

- **Replies without copy and paste**, through an optional end-to-end encrypted relay ([#281](https://github.com/simonvanlierde/credit-matrix/issues/281),
  [ADR 0004](adr/0004-encrypted-relay.md)). It waits until people other than me ask for it.

## Not planned

- Accounts or server-side storage of drafts ([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md)).
- An orchestrator for the census, until it has a second recurring job ([#214](https://github.com/simonvanlierde/credit-matrix/issues/214)).

To suggest something, open an issue. [CONTRIBUTING.md](../CONTRIBUTING.md) says how to send a change.
