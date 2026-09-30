# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- DOIs that Crossref does not know, such as arXiv and Zenodo records, are looked up in DataCite.
- *Delete all drafts* in the draft picker removes every draft from this browser.
- A second tab follows edits to the draft it has open, and says so.
- *About* says which lookups leave the browser, and the ask link says it carries names and iDs.

### Changed

- The app is a static export served without Worker code. The OpenNext Worker failed its cold start
  with Cloudflare error 1102 about once an hour, answering `503` for a minute or two.
- ORCID and DOI lookups go from the browser straight to ORCID and Crossref, which both allow it.
- `/health` is now `/health.json`.
- The CSP allows the site's own inline scripts by hash instead of `'unsafe-inline'`.
- The offline copy is precached per build, and a tab open across a deploy reloads once instead of
  falling back to English.
- Faster editing of long contributor lists: rows and grid cells re-render only when their own
  contributor changes.

### Fixed

- A DOI lookup that finished after the dialog closed could replace the draft's contributors.
- Two quick ORCID lookups on one row could pair one person's name with another's iD.
- Rolling back to an older version no longer deletes drafts saved by the newer one.
- The badge preview no longer requests an image URL a static host cannot serve.

### Removed

- The `/api/orcid` and `/api/doi` proxies and their rate limiter.

## [0.5.0] - 2026-08-27

### Added

- Below `lg` the lockup opens a menu carrying the *How it works* and *About* links the header has no
  room for. *About* is reachable from the welcome card too.
- Attribution for the CC BY 4.0 work the app redistributes. The role translations and NISO's badge
  image now link to the licence deed, and the notice travels with the badge.
- A copyright and licence line in *About*.

### Changed

- *About* is one panel shared by the header link, the lockup menu, and the welcome card. Its
  acknowledgements and the NISO disclaimer are shorter.

### Removed

- The *Saved in this browser* line, which never changed. The drafts menu and the welcome card
  already say it, and a failed save announces itself.

### Fixed

- The matrix controls sit beside their heading from `xl` instead of wrapping below it: *Bulk assign*
  is the icon alone, the step headings are a size smaller, and the statement column gives back width
  its 75ch prose never used.
- The wordmark no longer wraps out of the fixed header. It appears only from `27rem`; below that the
  mark carries the brand alone, and the name is still announced.
- The header nav moved from `md` to `lg`, where it stopped overrunning the row.
- Links inside a sentence are underlined, not only recoloured.

## [0.4.0] - 2026-08-27

### Changed

- The sample opens in Levels: its graded scores are the point, and yes/no hid them.
- No page-width cap: the workflow row is content-sized and centered, so a large roster gives the
  matrix the whole screen and every visible column is one it does not scroll, while a small roster
  leaves symmetric gutters instead of stretched cells. The contributors and statement columns are
  clamped.
- Both output panes organize the same way: the mode control stays visible, and the display options
  (the statement's wording toggles; the heatmap's color, transpose, and initials, now on one line)
  live behind an icon-only gear that never wraps away from its mode control. The CRediT badge gets
  its own line under the export controls instead of dangling off their right edge.
- The Levels legend hint is shorter and capped to one line, so toggling modes no longer bounces the
  heatmap export buttons. Their visible "Heatmap" label folded into the group's accessible name,
  keeping the whole footer on one line.

### Removed

- The in-pane "Clear local draft" flow and the pane's stays-in-this-browser footer note. Deleting
  a paper is the Drafts menu's job, and that menu already says drafts stay in this browser, right
  where deleting them lives.

### Fixed

- On narrow screens in Levels, a role button's label no longer sits on the dynamic fill, where a
  mid-tone preset had no readable text color at all; a small swatch carries the color instead.

## [0.3.0] - 2026-08-27

### Added

- Offline support: a service worker caches the app's own files, so a draft survives a lost
  connection, and a web app manifest makes it installable. The ORCID and DOI lookups are the only
  paths that still need a network, and now say so.
- DOI import: paste a DOI to fill the contributor list, their ORCID iDs, and the work's title from
  the published record, through a new `/api/doi` proxy to Crossref. Roles stay empty, because
  published records do not carry them.
- Drafts, one per paper. A picker in the header switches, renames, duplicates, and deletes them, up
  to fifty. They live in this browser, as everything else does.
- Collecting contributions from co-authors. A contributor's row menu copies a link addressed to
  that person, and an *Asked* chip tracks the open request. Opening the link locks the draft to
  the recipient's own row; a banner explains the lock, builds the reply link, and can release the
  draft into an ordinary one. The lock survives a refresh, and re-opening the same request resumes
  it instead of forking a duplicate.
- Replies merge on open. Clicking the returned link (or pasting it into Import) lands that one row
  on the paper it was asked about, confirmed by a visible banner with an Undo and an *Updated*
  mark on the row. On their own row the co-author is the authority: the name, iD, and author
  status they set on themselves ship back with their roles.
- A visible status strip for share and merge outcomes. These previously reached only screen
  readers, so a merge, a refusal, or a broken link looked like nothing happened.
- Shared first authorship and corresponding authors, which CRediT has no term for. They are noted
  under the statement and the Markdown table, carried as columns in CSV, and written as JATS4R
  `equal-contrib` and `corresp` attributes.
- Rich-text copy: the statement now goes to the clipboard as HTML alongside plain text, so pasting
  into a word processor keeps the emphasis on each label. Editors that want plain text still get it.
- A unit test layer for the app itself (Vitest on jsdom), covering the store and the `src/lib`
  helpers. The domain package and the Playwright suite already had their own.
- Bulk assignment: set or clear every role for one contributor, or one role across every
  contributor, from a popover in the contribution step.
- Undo for a removed contributor, and an explicit "Clear local draft" action with a confirmation.
- Rate limiting and stricter input validation on the upstream proxies. Both share one Worker
  binding, `API_RATE_LIMITER`; without it they fail open, unthrottled, and say so once in the
  invocation log.
- End-to-end coverage of the critical workflows, and release verification in CI. The whole
  Playwright suite now runs on every pull request; it previously ran only the accessibility scans,
  so a regression in import, undo, ORCID lookup, persistence, or export could merge green.
- `PRODUCT.md` and `DESIGN.md`, documenting the product brief and the design system.
- Arrow-key navigation in the contribution grid: the matrix is one tab stop, and Arrow, Home, and
  End move between cells, so crossing it no longer takes a tab press per cell.

### Changed

- Share links carry everything in one compressed fragment: the roster with stable contributor
  ids, the draft title, and, on requests and replies, whom the link addresses and which draft
  it came from. A ten-author link is roughly 1.4 kB instead of 18 kB, which is the difference
  between a link that survives an email client and one that does not. **Links built by earlier
  versions no longer open**; they fail with a visible message and leave the open draft untouched.
- UI copy: device-neutral *Select* for grid interactions, *Non-author* for the non-author
  contributor type, one neutral copy-failure announcement, and a localizable detected-format
  label.
- The persisted draft is stored as a map of drafts rather than a single workspace.
- The desktop workspace fits one viewport: the page no longer scrolls, and each of the three panes
  scrolls its own content. Short, zoomed, and narrow windows keep ordinary document flow.
- First-run guidance is a modal over the workspace instead of a band above it, so dismissing it no
  longer reflows the page.
- Heatmap controls (color, transpose, initials) moved into a popover beside the grid.
- The Content-Security-Policy now restricts scripts, connections, and form submissions. It
  previously set only `base-uri`, `frame-ancestors`, and `object-src`, which left everything else
  unrestricted.
- The ORCID proxy checks its rate limit before reading the request body, and gives up on an
  unresponsive upstream after five seconds instead of holding the request open.

### Fixed

- A share link no longer overwrites the paper you are working on: a whole draft someone sent opens
  as a new draft beside your own, and a reply whose draft is not in this browser is refused with a
  message instead of merging into whichever paper happened to be open.
- The title and the add-contributor field are read-only until the persisted draft has been restored.
  The store rehydrates from a mount effect, so there was a window in which the interface was live
  but still empty, and anything typed into it was overwritten the moment the draft landed.
- Renaming a contributor no longer clears the authorship markers set on them. Every mutation
  rebuilds the contributor through `createAuthor`, and two rebuild sites were dropping the fields.
- An ORCID iD attached to a contributor gets its own line, instead of pushing the contributor row
  onto a second line.
- Responsive and accessibility fixes across the contributor row, grid, and export controls.
- Hardened contributor data handling in `core`, and the lookup and response boundaries of the
  ORCID proxy.
- A multi-word surname survives a JATS round trip. Exporting and re-importing "van der Berg, Anne"
  returned middle name "van" with surname "Berg", which also changed the generated initials.
- The check mark in an assigned grid cell picks its color by measured contrast, so it stays legible
  on light grid colors. On several palette choices it was previously white on a pale fill.
- Keyboard focus survives removing a contributor, clearing the draft, and removing an ORCID iD.
  Each of those unmounted the button being pressed, dropping focus to the top of the page.
- Screen readers announce the contributor list as a list, with a count and a position per row.
- The statement and export controls stay reachable on short desktop windows, at high zoom, and with
  a larger minimum font size, instead of being clipped with no way to scroll to them.
- A share link carrying an unusable contributor shows an error and keeps the current draft, rather
  than failing to render the page.
- Editing one contributor's name is no longer overwritten when another contributor's ORCID lookup
  finishes.
- Drafts saved before the 500-character name limit keep working; over-long names are trimmed on
  load instead of breaking every later edit.
- Pasting an ORCID iD with a bad check digit says so, instead of reporting it as a name with no
  letters. At the 200-contributor limit, adding one more explains the limit.
- Correcting an ORCID iD after a checksum error and clicking away now saves the correction.

## [0.2.0] - 2026-07-14

### Added

- Editable contribution grid: roles and contributors in one matrix, where a click
  assigns a role or cycles its level. It doubles as the live heatmap, and its
  transpose, full-name, and color controls carry through to the SVG/PNG downloads.
- Bulk contributor entry: paste an author list (commas, newlines, semicolons, or
  ORCID iDs) and each name gets a row. Inverted names (`Smith, J. A.`) stay whole.
- First-run welcome card, re-openable from the header, and numbered step headings.
- Contribution levels in by-role statements, annotating contributors the way
  by-author statements already annotated roles.
- A link to each role's full NISO definition in its info popover.

### Changed

- The workspace fits one desktop screen: contributors beside the grid, statement
  full-width below.
- Exported heatmaps drop the baked-in image title and fit their label bands to
  their content.
- The About popover carries the version and source link; the header nav is down
  to two items.
- Copying an export format confirms on its own button.

### Fixed

- Comma-separated lists are split per line rather than per comma, so a name with
  multiple initials or a compound given name survives a paste intact.
- An entry with no name in it no longer aborts the rest of a pasted list; it is
  skipped and reported.

### Removed

- `@nivo/heatmap`, and the per-author role checklist beside it. The grid is a
  plain table, so cells are keyboard-reachable rather than an `aria-hidden` SVG.

Persisted local drafts migrate automatically.

## [0.1.1] - 2026-07-06

### Added

- Accessibility pass over the UI: skip link, page heading and landmark regions,
  keyboard-operable segmented controls, keyboard drag-to-reorder, and a live
  region announcing copy, ORCID-lookup, and import status.
- axe-core accessibility scans of the main screens in the Playwright suite.
- `CITATION.cff`, a `CONTRIBUTING.md` guide, and the first architecture decision
  record (`docs/adr`).
- Zenodo archival with a citable DOI
  ([10.5281/zenodo.21213659](https://doi.org/10.5281/zenodo.21213659)).

### Fixed

- Domain-logic bugs in author parsing, export, and validation.
- Hardened client-side runtime paths.

### Changed

- Pinned `@types/node` to the Node 26 runtime and declared an `engines` field.
- Dropped unused dependencies, dead exports, and speculative code.

## [0.1.0] - 2026-06-29

### Added

- Initial release: client-side CRediT contribution-statement generator with a
  contribution heatmap, JATS4R XML / CSV / JSON / Markdown exports, ORCID lookup,
  share links, and a framework-agnostic `@credit-generator/core` domain package.

[Unreleased]: https://github.com/simonvanlierde/credit-matrix/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/simonvanlierde/credit-matrix/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/simonvanlierde/credit-matrix/releases/tag/v0.1.0
