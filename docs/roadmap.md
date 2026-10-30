# Roadmap

What I plan to work on next. It is a plan, not a promise: CRediT Matrix has one maintainer
([GOVERNANCE.md](../GOVERNANCE.md)), and the order changes when users report problems. Shipped
changes are in the [changelog](../CHANGELOG.md).

## Now

- **Release 0.9.0.** The [changelog](../CHANGELOG.md) lists what it brings, among them pasting an
  existing statement into Import, ORCID sign-in for co-authors, the Published practice tab and
  the CRediT census page, tenzing CSV export, CodeMeta roles from the CLI, and the fixes from a
  WCAG 2.2 self-assessment. It also carries the breaking `DetectedFormat` change in the
  `credit-matrix` package.
- **Validate the census parser.** Score the parser that reads roles from published papers against
  labels that language models wrote and a person checks, so the census and the Published practice
  tab can drop their "preliminary" note. The
  [census README](../census/README.md#measuring-accuracy) says how it is measured now.
- **Stronger tests.** Mutation testing covers the import and export code in `src/core`
  ([CONTRIBUTING.md](../CONTRIBUTING.md)). Find more code the tests run but do not check.

## Next

- **More export formats.** tenzing CSV and CodeMeta roles now exist. Crossref is next, then other
  formats that contributorship tools and journal systems read.
- **Reviewed translations.** Ask native speakers to review the eight machine-made interface
  translations ([accessibility statement](accessibility.md#known-limitations)). The role names
  already come from the official CRediT translations.

## Later, or only if asked

- **Replies without copy and paste.** An optional end-to-end encrypted relay for co-author replies
  ([ADR 0004](adr/0004-encrypted-relay.md), proposed). It waits until people other than the
  maintainer ask for it.

## Not planned

- Accounts or server-side storage of drafts ([ADR 0002](adr/0002-no-accounts-or-server-side-storage.md)).

To suggest something, open an issue. [CONTRIBUTING.md](../CONTRIBUTING.md) says how to send a change.
