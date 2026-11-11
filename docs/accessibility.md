<!--
Keep this statement true. Every claim must be checkable in this repository: the tests in e2e/,
the lint rules in biome.json, the styles in src/app/globals.css. When a known problem is fixed,
move its bullet from "Known problems" to "How we check" in the same pull request as the fix.
The site renders this file at /accessibility, so write plain Markdown with absolute links, or #anchors within this page.
e2e/accessibility-statement.spec.ts checks the headings, the status, the contact and the
"Last reviewed" date.
-->

# Accessibility statement

This statement covers CRediT Matrix at [credit.duinlab.nl](https://credit.duinlab.nl), with its
CRediT census page and co-author reply page, and the `<credit-matrix>` web element in the
[credit-matrix npm package](https://www.npmjs.com/package/credit-matrix). Simon van Lierde builds
and maintains it, and is responsible for this statement.

## Using CRediT Matrix

You should be able to:

- draft a statement with the keyboard alone: move through the contributor list, reorder a
  contributor without dragging, move through the contribution grid with the arrow keys, and switch
  the inspector tabs;
- use it on a phone-sized screen, where the grid becomes a list of roles for each contributor;
- tell contribution levels apart without color: Lead, Equal and Supporting each have their own mark
  of three, two or one dots;
- use a dark theme, which follows your system setting until you pick one;
- reduce animations with your system's reduced-motion setting.

## How accessible CRediT Matrix is

CRediT Matrix aims to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at level AA.

Its conformance is **partially conformant**. The latest review, on 12 November 2026, checked sampled
pages, browser tests and the implementation against WCAG 2.2 AA. The
[self-assessment](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/accessibility-assessment.md)
records the evidence and the checks still needed. We have not tested the app with a screen reader
or commissioned an external audit. This review does not assess all requirements of EN 301 549.

## Known problems

- **Editors may not use a heatmap's description.** SVG downloads contain the contribution
  statement in their description, and PNG downloads contain it in a Description field. A word
  processor or slide tool may not turn that metadata into alt text. Clipboard transfers may
  discard it too. After inserting or pasting a heatmap, check its alt text and paste in the
  contribution statement if needed.
- **The PDF download is not tagged.** It includes a title, the contribution statement as its
  subject and the document language. It does not provide a tagged reading order or figure alternative.
- **No native speaker has checked eight of the nine languages yet.** The German, Spanish, French,
  Italian, Japanese, Dutch, European Portuguese and Simplified Chinese interface text was
  translated by machine. If a label is unclear, switch the language menu to English. The CRediT role names themselves come from the reviewed
  [credit-translation](https://github.com/contributorshipcollaboration/credit-translation) project.
  No fix date: it waits on volunteer reviewers.
- **This statement is in English only.** Its exact wording matters, so we don't machine-translate it.
  Your browser's translate feature gives a rough version. No fix planned.

### Content we don't control

- **ORCID sign-in.** Signing a co-author answer with ORCID opens orcid.org, which ORCID runs, so
  we have not assessed that authentication process. An answer can be sent without signing in.

## Tell us about a problem

If something in the app or the web element is hard or impossible for you to use, email
[credit@duinlab.nl](mailto:credit@duinlab.nl). You can also
[open an issue on GitHub](https://github.com/simonvanlierde/credit-matrix/issues/new), but you don't
need a GitHub account to report a problem.

Say what you were trying to do, what happened, and which browser and assistive technology you use,
if any. You will get a reply within 10 working days. If you need this statement, a contribution
statement or an export in another format, email us and we'll send it.

## How we check

- **Self-assessment.** The criterion-by-criterion
  [assessment](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/accessibility-assessment.md)
  records browser checks, source review and evidence gaps for the sampled pages and web element.
  It is repeated at each yearly review.
- **Automated scan.** The end-to-end tests run [axe-core](https://github.com/dequelabs/axe-core)
  with the WCAG 2.0, 2.1 and 2.2 level A and AA rules (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
  `wcag22a`, `wcag22aa`). They scan the welcome dialog, the empty and filled workspace, a phone-sized
  screen, the import dialog, an error state, an open popover, the published practice tab, dark
  mode, the about page and this statement, and the web element on a light page, a dark page and a
  320 px wide screen. See
  [e2e/a11y.spec.ts](https://github.com/simonvanlierde/credit-matrix/blob/main/e2e/a11y.spec.ts).
- **What a screen reader is given.**
  [e2e/screen-reader.spec.ts](https://github.com/simonvanlierde/credit-matrix/blob/main/e2e/screen-reader.spec.ts)
  reads the accessibility tree of the workspace, the grid, sampled popovers and dialogs, the co-author
  page, the census, the about page, this statement and the web element: the names, roles, states,
  headings and landmarks exposed to assistive technology. It also checks the expected live-region
  DOM messages for copying, removing, undoing and changing the grid. It does not check spoken output.
- **Keyboard tests.** The same tests use the keyboard alone to move through the contributor list,
  reorder a contributor without dragging, switch the inspector tabs, move through the grid with the
  arrow keys, open a role's description from its name, and use the segmented controls. They also
  check that focus stays in place after a contributor is removed, and that small icon buttons are
  at least 24 by 24 px in the measured sample.
- **Visual checks.** Browser tests check sampled contrast, focus rings, swatch selection in forced
  colors, and figure settings under reduced motion. Text-spacing tests check page width and access
  to figure downloads at phone and desktop widths. These use browser emulation; they do not replace
  testing native color dialogs, actual browser zoom or Windows High Contrast by hand.
- **Lint.** [Biome's accessibility rules](https://biomejs.dev/linter/javascript/rules/#a11y) check
  every change for things like missing alt text, invalid ARIA and click handlers without a keyboard
  equivalent.
- **This statement.**
  [e2e/accessibility-statement.spec.ts](https://github.com/simonvanlierde/credit-matrix/blob/main/e2e/accessibility-statement.spec.ts)
  fails when this page loses a section, claims full conformance, loses its email contact,
  or goes more than 400 days without a review.

Chromium runs all of this on every pull request that changes the app, and all three browsers
run it on every push to main and weekly. Automated tools find only part of
the problems a person can run into, so a passing run does not mean there are none.

Not checked yet: nobody who relies on a screen reader, switch access or voice control has tested
the app, and the self-assessment did not use a screen reader. The tests read the accessibility
tree a screen reader gets, but no screen reader has read it out, so how NVDA, JAWS or VoiceOver
speak it is not checked. Nobody has used the app in Firefox or Safari by hand.

### Heatmap text alternatives

The workspace grid exposes each contribution and its level to assistive technology. The export
preview also has the contribution statement as its image alternative. Downloaded SVG files contain
a title and description; downloaded PNG files contain the statement in a Description field.
Editors may not turn those fields into alt text. Check the alt text after inserting a figure into
a document, and paste the statement if needed.

### The web element

The [`<credit-matrix>` element](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/element.md)
draws a light card with dark text, so its text keeps enough contrast on a dark page. It supplies
assistive technology with a table instead of the drawing: a row per role, a column per contributor, and the
level (Lead, Equal, Supporting or None) in each cell. The element declares the language of its
statement, heatmap and table. Its loading and error messages are marked as English.

## Tested with

- Chromium, Firefox and WebKit, the engine Safari uses, in Playwright's desktop profiles, with
  axe-core: Chromium on every pull request, all three on every push to `main` and weekly. They
  cover the axe scans, this statement, the about page, the accessibility tree and the main
  workflows. Firefox and WebKit have no clipboard permissions, so
  the workflow tests that read the clipboard run there against a clipboard kept in the page.
  They don't check the browser's own clipboard.

CRediT Matrix relies on HTML, CSS, JavaScript, WAI-ARIA and SVG.

## About this statement

Prepared: 13 October 2026

Last reviewed: 12 November 2026

Next review: by 12 November 2027, or at the next major release if that comes first.

Method: self-assessment by the developer, using the browser and source checks under
[How we check](#how-we-check). No external audit.
