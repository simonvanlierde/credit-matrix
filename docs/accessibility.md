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
  translated by machine. If a label is unclear, switch the language menu to English.
  The CRediT role names come from the reviewed
  [credit-translation](https://github.com/contributorshipcollaboration/credit-translation) project.
  We need volunteer reviewers, so we cannot give a fix date.
- **This statement is in English only.** Its exact wording matters, so we don't machine-translate it.
  Your browser's translate feature gives a rough version. We have no plans to translate this statement.

### Content we don't control

- **ORCID sign-in.** Signing a co-author answer opens orcid.org, a separate service run by ORCID.
  We checked its initial sign-in page, but not the full sign-in process. You can send an answer
  without signing in.

## Tell us about a problem

If something in the app or the web element is hard or impossible for you to use, email
[credit@duinlab.nl](mailto:credit@duinlab.nl). You can also
[open an issue on GitHub](https://github.com/simonvanlierde/credit-matrix/issues/new), but you don't
need a GitHub account to report a problem.

Say what you were trying to do, what happened, and which browser and assistive technology you use,
if any. You will get a reply within 10 working days. If you need this statement, a contribution
statement or an export in another format, email us and we'll send it.

## How we check

We review the app against WCAG 2.2 AA each year. The
[self-assessment](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/accessibility-assessment.md)
lists the pages, checks and evidence for each criterion.

Our browser tests check:

- common tasks with the keyboard, including contributor order, grid navigation and figure downloads;
- the names, roles, states and messages the app supplies to assistive technology;
- sampled contrast, focus rings, control sizes, text spacing and narrow screens;
- settings with reduced motion and forced colors, which emulate some system accessibility settings;
- common accessibility errors with [axe-core](https://github.com/dequelabs/axe-core), using its WCAG 2.0, 2.1 and 2.2 A and AA rules.

Separate checks cover real 200% Chromium zoom in both themes and keyboard use of Chromium's
native color picker on Linux. These do not establish how other browsers or operating systems behave.
[Biome's accessibility rules](https://biomejs.dev/linter/javascript/rules/#a11y) also check code changes
for errors such as missing alt text and invalid ARIA attributes.

Tests guard this statement's sections, conformance status, email contact and review date.
They fail if a review is more than 400 days old.

Passing these checks does not mean we have found every problem. We have not checked spoken output
with NVDA, JAWS or VoiceOver, or tested with people who rely on screen readers, switch access or
voice control. We have not used the app in Firefox or Safari by hand, or tested Windows High Contrast
by hand.

### Heatmap text alternatives

The workspace grid gives assistive technology each contribution and its level. The export preview
has the contribution statement as its image alternative. SVG and PNG downloads also include the
statement, but editors may not use it as alt text. See [Known problems](#known-problems) before
inserting a figure into a document.

### The web element

The [`<credit-matrix>` element](https://github.com/simonvanlierde/credit-matrix/blob/main/docs/element.md)
draws a light card with dark text, so its text keeps enough contrast on a dark page. It supplies
assistive technology with a table instead of the drawing: a row per role, a column per contributor, and the
level (Lead, Equal, Supporting or None) in each cell. The element declares the language of its
statement, heatmap and table. Its loading and error messages are marked as English.

## Tested with

Automated tests use Chromium, Firefox and WebKit in Playwright's desktop profiles, with axe-core.
WebKit is the engine Safari uses; these tests do not replace testing Safari on Apple hardware.
Chromium runs on pull requests that change the app. All three run on pushes to `main` and weekly.

Firefox and WebKit workflow tests use a clipboard kept within the page. They check the app's copy
handlers, but do not test the browser's own clipboard.

CRediT Matrix relies on HTML, CSS, JavaScript, WAI-ARIA and SVG.

## About this statement

Prepared: 13 October 2026

Last reviewed: 12 November 2026

Next review: by 12 November 2027, or at the next major release if that comes first.

Method: self-assessment by the developer, using the browser and source checks under
[How we check](#how-we-check). No external audit.
