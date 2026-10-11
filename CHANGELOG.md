# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A page of its own for co-authors. Opening an ask link now shows one column, made for a phone:
  the 14 roles with a short description and None · Supporting · Equal · Lead buttons for each
  (None · Contributed when you work in Yes/No), switches for shared first authorship and
  corresponding author, and a *Send back* button that opens the phone's share sheet or copies the
  reply link. Name and ORCID iD can still be corrected under *Your details*, and *Keep as an
  ordinary draft* still opens the full workspace. Ask links from older versions open in levels.
- A blank ask. A contributor's menu now offers *Ask … what they did*, which sends their row with
  nothing ticked, beside *Ask … to check your guess*, which sends your guess as before. The co-author
  sees which one they got.
- Importing a JSON file from a newer version of CRediT Matrix says so, instead of a validation error.
- If you send a co-author a new request while they still have the old one open, opening the new
  link replaces their earlier answers and says so, with Undo. Opening the older link again just
  goes back to their draft.
- The JSON export includes your co-authors' answers, and importing the file into the same draft
  brings them back. Versions before this one ignore them.
- *Move up* and *Move down* in each contributor's menu, so the author order can be changed without
  dragging.
- Skip links to the grid and to the statement.
- The **Review** tab lists where each co-author's answer differs from your draft, per person, in
  the grid's dots: "Software: You ●● Equal → Ben ●●● Lead". For each difference choose
  *Use Ben's*, *Keep yours* or *Ask Ben about this*, which copies a message about that role with a
  link to check your guess. *Use all of Ben's* takes his whole answer. Each choice moves on to the
  next difference and animates the grid cell as it changes. Every decided line keeps its own Undo,
  also after *Use all*, and undoing *Use Ben's* puts your own level back.
- Grid cells where a co-author answered differently carry a corner mark, and a screen reader hears
  what they said ("Ben says Lead"). A count under each column header opens Review on that person.
- *This is me* in a contributor's menu marks your own row. You are left out of the Team tab, of
  asks, and of the answered count, and your column says "You". The JSON export remembers it, and
  importing the file back into the same draft marks you again.
- The Statement tab says when contributions still differ and that the statement uses your version,
  with a link to Review. Copying and exporting are never blocked.
- The Export data menu has an *Includes co-author answers* checkbox for the JSON file, ticked by
  default.

### Changed

- A co-author's reply no longer overwrites your row. Their name and iD are taken; their
  roles and markers are kept beside your row, and the status strip says how many differ ("Ben's
  answer arrived: 3 differences"), with Undo and a *Review* button, or that the answer matches yours. Until you choose, your row is
  what the statement uses.
- A reply older than the one you already have is ignored, and opening the same reply twice changes
  nothing. Undo on a reply restores the name and iD and leaves any edits you made since then alone.
- A new workspace layout. The contribution grid is now the main canvas, with the contributor list
  as a slim rail on the left (it folds to initials) and a panel on the right with three tabs:
  - **Statement**: the statement and *Copy statement*, plus one *Export data* menu where each format
    has its own Copy and Download.
  - **Team**: who you have asked and when, who answered and how much is left to review, and when
    each answer was settled; a *Copy message* button per person that copies an
    email-ready text with their ask link, and *Ask everyone not yet asked*, which copies one message
    per person in turn.
  - **Review**: co-authors' answers beside your draft (see Added).
- A strip above the grid shows how many co-authors answered and how many answers differ, with a
  *Review* button, and holds the Yes/No vs Levels
  switch, bulk assign, display options, and heatmap export (copy, SVG, PNG).
- Column headers show full names at an angle, with a mark under each for not asked, asked, open
  differences or settled.
  Past 20 contributors, or with *Use initials* on, they show initials.
- Selecting a role name opens its description; the separate info buttons are gone. From the grid,
  press the Left arrow on the first column to reach the role name.
- In dark mode the heatmap gets brighter from Supporting to Lead, as it gets darker in light mode.
  Downloaded heatmaps keep the light colors.
- *Import* and *Share* in the header are secondary buttons, and disabled buttons look disabled.
- The ask menu says in plain text what the link carries: the title, and that person's name and iD.
- An open tab no longer saves over drafts that a newer version saved in another tab. It reloads
  into the newer version, or says that its edits are not being saved when it cannot.
- Saved drafts move to a new storage version. Open asks carry over. An older version opened later
  starts empty and leaves the newer drafts in place. After updating, reload any other tab that still
  has CRediT Matrix open: a tab opened before the update has no such guard and can overwrite changes
  made in the updated version.

### Fixed

- The JATS4R XML export writes ORCID iDs as full `https://orcid.org/...` links, as JATS4R
  recommends. Importing accepts both the full link and the bare iD, so older files still load.
- Resetting a draft clears its open asks, and removing a contributor drops theirs (undo restores it).
- Keyboard and touch fixes: the grid's key hint (0–3 set a level) is always visible, cells announce
  their shortcuts, a focused cell no longer hides under the sticky headers, and small buttons in the
  contributor rows, status messages and heatmap controls have visible focus and 24px targets.
- The JATS4R XML export no longer claims "© 2019 JATS4R" and a CC BY licence for your paper. That
  block was sample text and is gone.
- The JATS4R XML export keeps contribution levels. Each role carries lead, equal, or supporting as
  JATS 1.3 `degree-contribution`, and importing the file restores them. Files without it import
  every role as lead, as before.

### Removed

- `/health.json`. It only served the post-deploy smoke test, which is gone too.

## [0.6.0] - 2026-09-30

### Added

- DOIs that Crossref does not know, such as arXiv and Zenodo records, are looked up in DataCite.
- *Delete all drafts* in the drafts menu clears every draft from this browser.
- A draft open in two tabs stays in step: an edit in one shows up in the other, with a note.
- *About* says which lookups leave your browser. The ask link says it carries names and iDs.

### Changed

- The site is now plain static files. The server it ran on failed about once an hour and showed an
  error page for a minute or two.
- ORCID and DOI lookups go straight from your browser to ORCID, Crossref and DataCite.
- The app loads less code, and long contributor lists respond faster.
- After an update, an open tab reloads once instead of switching to English.
- `/health` is now `/health.json`.

### Removed

- The `/api/orcid` and `/api/doi` endpoints.

### Fixed

- A DOI lookup that finished after you closed the dialog could replace your contributors.
- Two quick ORCID lookups on one row could pair one person's name with another's iD.
- A contributor you edited while their ORCID lookup failed was deleted.
- Going back to an older version deleted drafts saved by the newer one.

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

[Unreleased]: https://github.com/simonvanlierde/credit-matrix/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/simonvanlierde/credit-matrix/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/simonvanlierde/credit-matrix/releases/tag/v0.1.0
