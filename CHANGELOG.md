# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- A Published practice tab beside the grid shows how often published papers in a field give each
  CRediT role, for sole, first, middle and last authors. Pick your field once and the app remembers
  it; mark your own row with "This is me" and your column is marked, counting authors only. The
  shares come from about 1.7 million open-access research articles in Europe PMC. They are context
  only: nothing here fills in or comments on your grid. The roles were read from the papers
  automatically and have not been checked by hand yet, and the tab says so, with the article count
  for the field. Fields with fewer than 1,000 articles are not listed.
- A CRediT census page (`/census`, linked from the header on wide screens and from About) shows how published papers use CRediT,
  from 8.2 million open-access articles in Europe PMC: the share of research articles with roles
  per year, by markup style, field and publisher, and which roles first, middle and last authors
  hold. The figures are preliminary: the parser that reads the roles is not yet validated against
  hand labels. The counts behind the page are at `/data/census.json`. A short section
  explains how the census reads statements, with links to the census code and the model card.
- Co-authors can sign in with ORCID before they send their answer back. The Review tab then shows
  "Verified by ORCID" with their name, iD and sign-in day, and warns when that iD is not the row's.
  The sign-in travels inside the reply link and JSON exports; no server keeps it. A sign-in moved
  onto another answer does not verify, and importing a JSON export checks each sign-in again.
  If ORCID cannot be reached then, the answer arrives without the mark; try again later to add it.
- Paste an existing author contribution statement into Import to fill in the grid. It is matched to
  the contributors already in the draft, by full name or initials ("MG", "S.L.V.", "Nam KC"), and
  each line counts as its own entry. You see which roles each person gets, and for each name or
  initials that matched no one, or more than one, who it could be and which roles are left out,
  before you apply. In a Levels draft you pick the level the roles get (Equal unless you change it).
  Undo takes the roles back until you change the draft again. Only CRediT wording counts, so "drew
  the figures" or "approved the manuscript" add nothing. Statements are read up to 50,000
  characters, and never leave the browser.
- Export a draft as a tenzing contributor spreadsheet (Export data, then "tenzing CSV"), so a team
  can move between the two tools. It has the columns of tenzing's own example sheet. tenzing records
  a role as done or not, so any level becomes TRUE, and it has no column for equal contribution.
  Acknowledgees are marked "Acknowledgment only", the value tenzing keeps, and are listed and
  numbered after the authors, as tenzing needs. An acknowledgee is never marked as the corresponding
  author. The `credit-matrix` package exports it as `toTenzing`.
- The `credit-matrix` package exports `parseStatement`, `statementAuthor`, `namesCredit` and
  `MAX_STATEMENT_LENGTH`. `parseStatement` also returns `unmatched`: each unresolved name or
  initials once, with the authors it could be and the roles it was given. It throws a `RangeError`
  on a statement longer than `MAX_STATEMENT_LENGTH` (50,000 characters).
- In the `credit-matrix` package, replies can carry `provenance.orcid` (the new `OrcidProof` type)
  and `provenance.replacedOrcid`; run `recheckSignIns` on imported asks.
- An About page (`/about`) says what the app is, how to cite it by its concept DOI, whom it
  thanks, and, in its own Privacy section, what it sends where. The About panel is now a short card
  that links to it.
- The accessibility statement is now on the site, at `/accessibility`, rebuilt as a reader-first
  page: what you should be able to do, its status against WCAG 2.2 AA, known problems
  each with a workaround, an email contact with a 10-working-day reply time, how we check, what it
  was tested with, and when it was last reviewed. `docs/accessibility.md` stays the one source; the
  build turns it into static HTML.
- A WCAG 2.2 self-assessment (`docs/accessibility-assessment.md`) judges every level A and AA
  criterion with its evidence. It finds no failing criterion; the statement says "partially
  conformant" until a screen reader has read the app.
- Downloaded heatmaps carry the contribution statement as their text alternative: the SVG in its
  description, which screen readers read, the PNG in its Description field. Before, the SVG said
  only "Contribution heatmap" and the PNG had no text at all. Both are tagged with the output
  language, so a screen reader reads them in that language. In the `credit-matrix` package,
  `heatmapDescription` returns the same text, and `buildHeatmapSvg` sets `xml:lang` and `lang` when
  you pass `locale`.
- Census: for people who run it, `census model` trains and checks a model that reads contribution
  statements. A fine-tuned encoder and a hybrid of the rule parser and the encoder sit beside the
  rule parser, and `census model browser` exports the encoder for the browser. `--seed` fixes a
  run, `--learning-rate` sets its learning rate, and `--open-licence-only` trains on CC BY and CC0
  articles only, so the weights can be shared. Without it, about 9% of a 120,000-article draw came
  from articles under other licences. `census score` now also scores each role on its own.
- Census: `census label --set --sizes 700 150 150` draws a larger hand-label set, such as the
  1,000-row set, with the rows per style you choose. The default stays 100, 30 and 30.
- A [model card](census/MODEL_CARD.md) for the Ettin-68M model that reads statements in the census
  and in the browser build: what it was trained on, its scores, its limits and how to cite it.
- Project documents: governance, a roadmap and a security model, plus sections on disclosure, the
  maintainer and the sign-off (DCO). The README shows the OpenSSF Scorecard badge.

### Changed

- **Breaking:** in the `credit-matrix` package, `DetectedFormat` gains `"statement"`, which
  `detectFormat` returns for a CRediT statement or for prose about what the authors did. Such text
  used to come back as `"names"`. `importAny` now throws on it, as it names roles, not
  contributors: read it with `parseStatement` against your author list. A `switch` over
  `DetectedFormat` needs the new case. The next release is therefore 0.9.0.
- Primary buttons darken on hover instead of fading, so their text stays readable.
- Census: the counts behind `/census` and the field norms were rebuilt with the second version of
  the statement parser. Counts move by a few articles per year and field, and shares by at most
  0.001. The census README now gives how well the Ettin-68M model agrees with the rule parser on
  the whole corpus.

### Fixed

- Accessibility fixes from the WCAG 2.2 self-assessment:
  - Placeholder text, text-field edges, empty grid cells and the reorder handle now have enough
    contrast in both themes, and the contributor name field shows a focus ring.
  - At 200% zoom on a laptop the header no longer runs off the screen and hides Import.
  - Undo after a bulk change stays 60 seconds, like every other Undo, instead of 8.
  - Focus no longer goes under the sticky bar on a phone, or under a status message.
  - A dialog closes only when you press and release on the backdrop, so a stray press keeps your
    typed text.
  - Escape hides the census chart's value readout.
  - An ORCID iD, name or co-author name that is refused now says why, and the message stays
    until you change the field. Screen readers hear it, and also hear which file was loaded in
    Import.
  - Every popover panel has a name for screen readers.
  - Screen readers hear a removed contributor and a bulk change once, through the same live
    region as every other message. Before, the removal could go unheard and the bulk change was
    said twice. Each Undo button now says what it undoes.
  - After Undo, focus goes to the contributor who came back, or to the bulk-assign button, instead
    of the top of the page. The same happens when an Undo you are on runs out of time.
  - A grid change is read out once, without the statement's contributor and role counts after it.
  - Screen readers no longer read a contributor's initials before their name.
  - On the co-author page each role name is a heading, so a screen reader can jump from role to
    role. The role headings sit under a "Your roles" heading, so the switches and the ORCID sign-in
    after the list no longer read as part of the last role.
- "How it works" did nothing outside the main page. It now takes you there and opens the welcome
  panel, and closing the panel puts focus on the main content.
- Reading a JATS XML file no longer takes punctuation in a given name for a middle name. A
  contributor exported as "Smith & Co Lee" came back with the middle name "&" instead of "Co", and
  with the wrong initials.
- JATS XML export no longer drops words from a name that ends in punctuation. "Martin Luther King
  Jr." used to come back as "Martin Luther Jr", and "Ann B. C. Smith." as "Ann B Smith".
- CSV export keeps a leading apostrophe in a name that starts with a line break or spaces. It used
  to come back without the apostrophe.
- Census: the parser reads more statements right. A clause that ends in initials after a full stop
  ("Investigation, methodology. S.H.; supervision. T.D.") keeps its roles together. A semicolon
  between authors with no role before it stays inside one author list. Initials without accents
  match accented names ("N.N.A." for Nguyễn Ngọc Ánh).
- Census: a trained model's config names its 14 role outputs. It called them `LABEL_0` to
  `LABEL_13`, so anyone loading the weights had to look up the role order.
- Census page: a chart no longer draws outside its box when its highest value is above the last tick
  of the axis. The contribution-statement share peaks at 28.6% and the axis stopped at 20%. The
  "preliminary figures" notice is shorter, in all nine languages.

### Security

- JATS XML import, in the app and the CLI, refuses a file that declares entities (`<!ENTITY`). The
  browser expanded them and the CLI did not, so one file could import different names in each, and
  a file with nested entities could freeze the browser tab for several seconds. JATS exports from
  this app and other tools do not declare entities.
- Updated build and test tools past published advisories: `fast-uri`, `undici` and, in the census,
  `filelock` and `setuptools`. They are development dependencies only. The app and the
  `credit-matrix` package do not ship them.
- Updated `qs`, a test-tool dependency, past three published advisories. It is a development
  dependency only.

## [0.8.1] - 2026-10-13

### Fixed

- `credit-matrix` with no command now prints a one-line error naming the commands and exits with
  2, like any other mistake in the command line. It used to print the help and exit with 0, so a
  script could not tell it from success.
- The package's README on npm now says to install it with `npm install credit-matrix`. It still
  described the package as not yet published.

## [0.8.0] - 2026-10-13

### Added

- A [Quarto extension](integrations/quarto/README.md) that writes a CRediT authorship statement
  from the author `roles` in a document's front matter, with Equal and Supporting levels.
- A [MyST plugin](integrations/myst/README.md) with a `{credit-statement}` directive that does the
  same from the authors in `myst.yml` or the page's front matter.
- The `credit-matrix` npm package: the statements, file formats, heatmap and ask links behind the
  app, for your own scripts and sites, in Node or the browser. ORCID and DOI lookups are under
  `credit-matrix/lookup`, the role translations under `credit-matrix/i18n`.
- A `credit-matrix` command line tool, from the same package: `statement` prints the CRediT
  statement for a JSON, CSV, JATS4R XML or name-list file, in any of the nine languages; `convert`
  turns one format into another; `ask` prints an ask link for one contributor.
- A `<credit-matrix>` web element that shows the statement and the heatmap for a JSON export on any
  page, without a framework, in any of the nine languages (`locale`, or the page's `lang`). It
  stays readable on dark pages and in narrow columns, and screen readers get the levels as a
  table. [docs/element.md](docs/element.md) has a copy-paste example.
- Import a [tenzing](https://github.com/marton-balazs-kovacs/tenzing) contributor spreadsheet.
  Save it as CSV or TSV first; Excel files are not read. Sheets saved with semicolons, as Excel
  does in Dutch, German or French, work too. Names, author order, ORCID iDs, roles,
  corresponding authors and acknowledgees (as non-authors) come across. tenzing records a role as
  done or not, so each ticked role imports at Lead.
- A JATS conformance suite in [`conformance/`](conformance/README.md): contributor lists with the
  JATS XML CRediT Matrix writes for each, all checked against the JATS 1.3 DTD and the JATS4R
  rules. Other tools that write CRediT roles into JATS can test themselves against it.
- An [accessibility statement](docs/accessibility.md), linked from the About panel: what the app
  aims for (WCAG 2.2 AA), how it is checked, what is known not to work yet, and how to report a
  problem.

### Changed

- Surname particles stay with the surname however the name is written: "Anne van der Berg",
  "Anne Van der Berg" and "van der Berg, Anne" all have surname "van der Berg", and JATS XML writes
  `<given-names>Anne</given-names>`. Particles are recognised in any case, and dos, das, do, los,
  las, degli, dei, dalla, dal, zu, zur, af, bin, ibn, el, al and van't are now among them. This
  applies to the `credit-matrix` package too.
- Initials skip surname particles: "Anne van der Berg" is AB (was AVB) and "Leonardo da Vinci" is
  LV. Contributors already in a draft keep their initials until the contributor list next changes.

### Fixed

- Offline use: the app now always saves its offline copy. A cut-off file link in the page could
  make that step fail, so the app would not load without a network.
- Drafts open in two tabs: a tab you opened earlier no longer saves its old copy of a draft over
  the edits you made to it in another tab, and a draft created in another tab shows in this tab's
  list straight away. A draft deleted in another tab stays here until you reload.
- Opening a share link or a co-author's reply no longer switches you to another tab's draft or
  drops changes that had not been saved yet.
- When the browser stops saving, a notice under the header now says so, and stays until saving
  works again. Before, only screen readers heard it. The notice says whether storage is full or the
  browser blocks it for this site. When a newer version has saved your drafts in another tab, its
  notice also stays until you reload, instead of disappearing behind the next message.
- With site data blocked in the browser, the app now works (without saving) instead of leaving
  every field read-only.
- Import: screen readers now read the DOI hint and any error with the field they belong to, a file
  dropped beside the drop zone no longer replaces the page, and the dialog names the file it read.
- CSV import: a quote inside a name (`Ann O"Brien`) is read as part of the name. It used to swallow
  the rest of the file into that one contributor. A quoted cell after a space (`Name, "Smith, Jane"`)
  is still read as one cell.
- Importing a name with a very long run of spaces no longer freezes the page.
- Pasted names separated by Word's Shift+Enter line breaks now become separate contributors, and
  control characters in a name become a space, so JATS XML and heatmap SVG exports stay valid XML.
- CSV and JATS XML import match column headers and role names whatever their case or dash, as
  tenzing import already did: `name`, `conceptualization` and `Writing - original draft` are no
  longer refused or dropped, and a `Non-author` Type cell is read as a non-author. Full-width
  hyphens and decomposed accents match too. A CSV score cell may also hold a level word (`Lead`,
  `Equal`, `Supporting`, `None`); it used to read as 0.
- JATS XML import: members of a group author (`<collab>`) import once each instead of twice, and
  line breaks or extra spaces inside a name are dropped.
- DOI lookup: a DOI copied from the address bar with `%3C`-style escapes is now found; it used to
  come back as not found. A bare DOI that contains `%` is looked up as typed.
- JSON import: a contributor whose stored first name, middle name or surname is empty or no longer
  matches the name gets initials from the name itself, instead of the whole name or stale letters.
- CSV and tenzing import skip a row with no usable name (empty, or no letters) and keep the other
  rows, as JATS XML import does. One bad row used to stop the whole import. A CSV without a Name
  column is still refused.
- Statements: a contributor name containing `{level}` or `{names}` is printed as written.
- Pressing Escape in a contributor's name field now discards what you typed, instead of saving it.
- Adding a contributor as a name and an ORCID iD together ("Jane Smith 0000-0002-1825-0097"),
  typed or in a pasted list, keeps the name you typed. It was replaced by the name ORCID has on
  record, or lost when the lookup failed.
- A contributor you rename while their ORCID name is still being looked up keeps your name, also
  while you are still typing it.
- A name typed next to an ORCID iD drops full-width punctuation around it ("王小明：…" keeps
  "王小明").
- Undoing the removal of the contributor marked *This is me* marks them as you again.
- Undoing a contributor's removal after the grid's Undo already brought them back no longer
  claims the draft is at its 200-contributor limit.
- Import: clicking *Import* twice on a pasted share link no longer opens the draft a second time.
- Team: removing a contributor during *Ask everyone* skips them and goes on to the next person,
  instead of stopping the sequence, and the sequence ends when nobody is left in it.
- Dragging in the custom heatmap color picker no longer redraws and saves the grid at every step,
  which made it stutter on large teams. The grid takes the color once you pick it, also when the
  popover closes first. Screen readers name the color input by its visible label, *Custom*.
- On phones, the *Contributor to assign* picker stays in view while you scroll the role list.
- Keyboard: an option group with nothing selected can be reached with Tab, and Alt+Left (browser
  Back) works while an option has focus.

## [0.7.0] - 2026-10-13

After updating, reload any other tab that still has CRediT Matrix open. A tab opened before the
update does not know the new storage version and can overwrite changes made in the updated one.

### Added

- `codemeta.json`, so software registries can read the project metadata. `pnpm version` keeps its
  version and release date in step, as it does for `CITATION.cff`.
- Every CI run checks the JATS4R XML export against the official JATS 1.3 DTD and the JATS4R
  Schematron rules (`pnpm validate:jats`).
- A page of its own for co-authors. Opening an ask link now shows one column, made for a phone.
  It has the 14 roles, each with a short description and None · Supporting · Equal · Lead buttons
  (None · Contributed when you work in Yes/No). Below them are switches for shared first authorship
  and corresponding author, and a *Send back* button that opens the phone's share sheet or copies
  the reply link. Co-authors can still correct their name and ORCID iD under *Your details*, and
  *Keep as an ordinary draft* still opens the full workspace. Ask links from older versions open in
  levels.
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
  what they said ("Ben says Lead"). The mark has an outline that stands out on every level, in every
  heatmap colour and both themes. A count under each column header opens Review on that person.
- *This is me* in a contributor's menu marks your own row. You are left out of the Team tab, of
  asks, and of the answered count, and your column says "You". The JSON export remembers it, and
  importing the file back into the same draft marks you again.
- The Statement tab says when contributions still differ and that the statement uses your version,
  with a link to Review. Copying and exporting are never blocked.
- The JSON row of the Export data menu has an *Include co-author answers and ask history* checkbox,
  ticked by default.
- The privacy note in About says that co-author asks and answers stay in this browser, that the JSON
  export includes them unless you untick that box, and that sending a reply hands its link to the
  app you pick.

### Changed

- A co-author's reply no longer overwrites your row. Their name and iD are taken over. Their
  roles and markers are kept beside your row, and the status strip says how many differ ("Ben's
  answer arrived: 3 differences"), with Undo and a *Review* button. If the answer matches yours, it
  says that instead. Until you choose, the statement uses your row.
- A reply older than the one you already have is ignored, and opening the same reply twice changes
  nothing. Undo on a reply restores the name and iD and leaves any edits you made since then alone.
- A new workspace layout. The contribution grid is now the main canvas, with the contributor list
  as a slim rail on the left (it folds to initials) and a panel on the right with three tabs:
  - **Statement**: the statement and *Copy statement*, plus one *Export data* menu where each format
    has its own Copy and Download.
  - **Team**: who you have asked and when, who answered, how much is left to review, and when
    each answer was settled. A *Copy message* button per person copies a text ready for an email,
    with their ask link. *Ask everyone not yet asked* copies one message per person in turn.
  - **Review**: co-authors' answers beside your draft (see Added).
- A strip above the grid shows how many co-authors answered and how many answers differ, with a
  *Review* button. It also holds the Yes/No vs Levels switch, bulk assign, display options, and
  heatmap export (copy, SVG, PNG).
- Column headers show full names at an angle, with a mark under each for not asked, asked, open
  differences or settled.
  Past 20 contributors, or with *Use initials* on, they show initials.
- Selecting a role name opens its description. The separate info buttons are gone. From the grid,
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
- The JATS4R XML export marks shared first authorship only when at least two authors share it. A
  single marked author made the file break the JATS4R rules. The mark still travels in JSON and CSV.
- Resetting a draft clears its open asks, and removing a contributor drops theirs (undo restores it).
- After *Reset* or *Delete all drafts*, Undo for a removed contributor or a bulk change no longer
  brings the cleared work back. A bulk change's Undo also no longer follows you to another draft.
- Keyboard and touch fixes: the grid's key hint (0–3 set a level) is always visible, cells announce
  their shortcuts, a focused cell no longer hides under the sticky headers, and small buttons in the
  contributor rows, status messages and heatmap controls have visible focus and 24px targets.
- The JATS4R XML export no longer claims "© 2019 JATS4R" and a CC BY licence for your paper. That
  block was sample text and is gone.
- The JATS4R XML export keeps contribution levels. Each role carries lead, equal, or supporting as
  JATS 1.3 `degree-contribution`, and importing the file restores them. Files without it import
  every role as lead, as before.
  In Yes/No mode the export leaves `degree-contribution` out, rather than call every role lead:
  you never chose a level. Such a file imports every role as contributed.

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

[Unreleased]: https://github.com/simonvanlierde/credit-matrix/compare/v0.8.1...HEAD
[0.8.1]: https://github.com/simonvanlierde/credit-matrix/compare/v0.8.0...v0.8.1
[0.8.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/simonvanlierde/credit-matrix/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/simonvanlierde/credit-matrix/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/simonvanlierde/credit-matrix/releases/tag/v0.1.0
