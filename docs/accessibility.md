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
- stop the animations with your system's reduced-motion setting.

## How accessible CRediT Matrix is

CRediT Matrix aims to meet [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at level AA, and through it the
web requirements of
[EN 301 549 v4.1.1](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf).

Its conformance is **partially conformant**. The self-assessment found no criterion it fails, but
it checks a sample of pages and no screen reader has read the app yet, so it does not claim full
conformance. The developer checked the app and
the web element against every WCAG 2.2 level A and AA criterion on 24 October 2026, in the
[self-assessment](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/accessibility-assessment.md).
On 26 October 2026 a second pass read what a screen reader is given on each page and ran the
checks in Firefox and WebKit too. There has been no external audit. What is checked, and how, is
under [How we check](#how-we-check).

## Known problems

- **Editors may not use a downloaded heatmap's description.** Both image files carry the
  contribution statement as their text alternative: the SVG in its description, which screen
  readers read, and the PNG in its Description field. A word processor or slide tool may not turn
  that field into alt text. When you put the heatmap in a paper or slide, check its alt text there,
  and paste in the contribution statement if it is empty. **Copy PNG** is worse: Chromium drops the
  Description field from a copied image, so paste the contribution statement in as alt text, or
  use **Download PNG** or **Download SVG**.
- **No native speaker has checked eight of the nine languages yet.** The German, Spanish, French,
  Italian, Japanese, Dutch, European Portuguese and Simplified Chinese interface text was
  translated by machine. If a label is unclear, switch the language menu to English. The CRediT role names themselves come from the reviewed
  [credit-translation](https://github.com/contributorshipcollaboration/credit-translation) project.
  No fix date: it waits on volunteer reviewers.
- **This statement is in English only.** Its exact wording matters, so we don't machine-translate it.
  Your browser's translate feature gives a rough version. No fix planned.

### Content we don't control

- **ORCID sign-in.** Signing a co-author answer with ORCID opens orcid.org, which ORCID runs, so
  its accessibility is up to ORCID. An answer can be sent without signing in.

## Tell us about a problem

If something in the app or the web element is hard or impossible for you to use, email
[credit@duinlab.nl](mailto:credit@duinlab.nl). You can also
[open an issue on GitHub](https://github.com/simonvanlierde/credit-matrix/issues/new), but you don't
need a GitHub account to report a problem.

Say what you were trying to do, what happened, and which browser and assistive technology you use,
if any. You will get a reply within 10 working days. If you need this statement, a contribution
statement or an export in another format, email us and we'll send it.

## How we check

- **Self-assessment.** Every WCAG 2.2 level A and AA criterion was judged in Chromium on a sample
  of the app, the co-author page, the census, the about page, this statement and the web element,
  with the result and its evidence per criterion in the
  [self-assessment](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/accessibility-assessment.md). It is repeated at each yearly review.
- **Automated scan.** The end-to-end tests run [axe-core](https://github.com/dequelabs/axe-core)
  with the WCAG 2.0, 2.1 and 2.2 level A and AA rules (`wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`,
  `wcag22a`, `wcag22aa`). They scan the welcome dialog, the empty and filled workspace, a phone-sized
  screen, the import dialog, an error state, an open popover, the published practice tab, dark
  mode, the about page and this statement, and the web element on a light page, a dark page and a
  320 px wide screen. See
  [e2e/a11y.spec.ts](https://github.com/simonvanlierde/credit-matrix/blob/main/e2e/a11y.spec.ts).
- **What a screen reader is given.**
  [e2e/screen-reader.spec.ts](https://github.com/simonvanlierde/credit-matrix/blob/main/e2e/screen-reader.spec.ts)
  reads the accessibility tree of the workspace, the grid, every popover and dialog, the co-author
  page, the census, the about page, this statement and the web element: the names, roles, states,
  headings and landmarks a screen reader reads out. It also logs every message that reaches a live
  region, and checks that copying, removing, undoing and changing the grid are each announced once.
- **Keyboard tests.** The same tests use the keyboard alone to move through the contributor list,
  reorder a contributor without dragging, switch the inspector tabs, move through the grid with the
  arrow keys, open a role's description from its name, and use the segmented controls. They also
  check that focus stays in place after a contributor is removed, and that small icon buttons are
  at least 24 by 24 px.
- **Lint.** [Biome's accessibility rules](https://biomejs.dev/linter/javascript/rules/#a11y) check
  every change for things like missing alt text, invalid ARIA and click handlers without a keyboard
  equivalent.
- **This statement.**
  [e2e/accessibility-statement.spec.ts](https://github.com/simonvanlierde/credit-matrix/blob/main/e2e/accessibility-statement.spec.ts)
  fails when this page loses a section, claims full conformance, loses its email contact,
  or goes more than 400 days without a review.

All of this runs on every pull request and every push to main. Automated tools find only part of
the problems a person can run into, so a passing run does not mean there are none.

Not checked yet: nobody who relies on a screen reader, switch access or voice control has tested
the app, and the self-assessment did not use a screen reader. The tests read the accessibility
tree a screen reader gets, but no screen reader has read it out, so how NVDA, JAWS or VoiceOver
speak it is not checked. Nobody has used the app in Firefox or Safari by hand.

### Heatmap text alternatives

In the app, screen readers skip the heatmap drawing, and the contribution statement beside it says
the same in words. The downloaded SVG has the title "Contribution heatmap" and, as its description,
the contribution statement by author. The downloaded PNG carries the same statement in its Description field; a copied PNG does not.
The first known problem says where that text gets lost.

### The web element

The [`<credit-matrix>` element](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/element.md)
draws a light card with dark text, so its text keeps enough contrast on a dark page. Screen readers
skip the heatmap drawing and read a table instead: a row per role, a column per contributor, and the
level (Lead, Equal, Supporting or None) in each cell. The element marks the language of its
statement, heatmap and table, so screen readers pronounce it right. Its loading and error messages
are in English, and marked as English.

## Tested with

- Chromium, in Playwright's desktop Chrome profile, with axe-core, on every pull request.
- Firefox and WebKit, the engine Safari uses, in Playwright, once on 26 October 2026: the axe
  scans, this statement, the about page, the accessibility tree and the main workflows. Five
  workflow tests that read the clipboard could not run there.

We haven't tested Firefox or Safari by hand, or tried a screen reader.
CRediT Matrix relies on HTML, CSS, JavaScript, WAI-ARIA and SVG.

## About this statement

Prepared: 13 October 2026

Last reviewed: 26 October 2026

Next review: by 26 October 2027, or at the next major release if that comes first.

Method: self-assessment by the developer, following WCAG-EM, with the checks under
[How we check](#how-we-check). No external audit.
