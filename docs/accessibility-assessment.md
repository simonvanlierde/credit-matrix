# WCAG 2.2 self-assessment

This is the criterion-by-criterion check behind the [accessibility statement](accessibility.md).
It covers every level A and AA success criterion of [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and
follows the steps of [WCAG-EM](https://www.w3.org/TR/WCAG-EM/): set the scope, pick a sample,
judge each criterion on it, report.

- **Date:** 24 October 2026, on the build of the commit that added this file.
- **Updated:** 26 October 2026. A second pass read the accessibility tree of every sampled surface
  with Playwright's aria snapshots, logged every live-region message, and ran the axe, statement,
  about, CSP, accessibility-tree and main workflow tests in Firefox and WebKit, the engine Safari
  uses. Five workflow tests could not run there: they read the clipboard, which Playwright can only
  allow in Chromium. It fixed four problems, listed under 1.3.1, 2.4.6 and 4.1.3.
- **Who:** the developer. This is not an external audit.
- **Browser:** Chromium (Playwright's desktop Chrome profile), at 1280 px, 640 px, 390 px and
  320 px wide, in the light and dark themes. Firefox and WebKit through Playwright, at 1280 px.
- **Not done yet:** a screen-reader pass (NVDA or VoiceOver), and keyboard runs in Firefox and
  Safari by hand. Rows that only a screen reader can settle say so.

## Sample

- The workspace (`/`), empty and filled: the welcome and import dialogs, every popover and menu,
  the four inspector tabs, the contribution grid and the phone layout of it.
- The co-author reply page, opened from a share link.
- The census (`/census`), the about page (`/about`) and the accessibility statement (`/accessibility`).
- The `<credit-matrix>` web element on a light page, a dark page and a 320 px wide page.

## How each criterion was judged

Each verdict rests on something seen in the browser, not on reading the code alone:

- axe-core with the WCAG 2.0, 2.1 and 2.2 A and AA rules;
- keyboard-only runs of every task, with forward and reverse Tab walks;
- contrast measured from computed colours over the real backgrounds;
- reflow at 320 px and text spacing at the WCAG 1.4.12 values;
- focus rectangles compared with the sticky bars and banners;
- target sizes measured from bounding boxes;
- the accessibility tree read with Playwright's `ariaSnapshot()`, surface by surface, in
  `e2e/screen-reader.spec.ts`, which also logs every message that reaches a live region.

Where a problem was found and fixed, the Evidence column names the test that now guards it. Each
of those tests failed before its fix.

## Results

Pass: no failure found after a real check. Fail: at least one failure in the sample.
N/A: the page has no content the criterion applies to.

### Perceivable

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | Pass | In the app every image has a text alternative or is decorative, and the statement and table repeat the heatmap. Each census chart has a sentence of its numbers and a table. The downloaded SVG has the contribution statement as its `<desc>` and the PNG as a Description text chunk; `e2e/screen-reader.spec.ts` downloads both through the menu and checks them. Editors may not use the PNG's, and Chromium drops it from a copied PNG: see Known problems in the statement. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | A | N/A | No audio or video. |
| 1.2.2 Captions (Prerecorded) | A | N/A | No audio or video. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A | N/A | No audio or video. |
| 1.2.4 Captions (Live) | AA | N/A | No audio or video. |
| 1.2.5 Audio Description (Prerecorded) | AA | N/A | No audio or video. |
| 1.3.1 Info and Relationships | A | Pass | Landmarks, headings, real tables with header cells, lists, tabs and radio groups in the accessibility tree, the same in Chromium, Firefox and WebKit. Fixed: the co-author page's 14 role names were not headings, and each initials badge was read as well as the name beside it. `e2e/screen-reader.spec.ts` checks both. Screen-reader check still to do. |
| 1.3.2 Meaningful Sequence | A | Pass | The accessibility tree of each sampled surface follows the visual order (`e2e/screen-reader.spec.ts`); no positive `tabindex`. |
| 1.3.3 Sensory Characteristics | A | Pass | Instructions name controls by their text. |
| 1.3.4 Orientation | AA | Pass | No orientation lock in the CSS, scripts or web manifest. |
| 1.3.5 Identify Input Purpose | AA | Pass | The co-author's own name field has `autocomplete="name"`; other fields hold other people's data. |
| 1.4.1 Use of Color | A | Pass | Levels have one, two or three dots; links in text are underlined; errors are in words. |
| 1.4.2 Audio Control | A | N/A | No audio. |
| 1.4.3 Contrast (Minimum) | AA | Pass | Fixed: placeholders were 1.5 to 3.3:1. `e2e/visual-contrast.spec.ts` checks them at 4.5:1 in both themes. |
| 1.4.4 Resize Text | AA | Pass | Fixed: at 640 to 700 px (200% zoom) the header ran past the edge and hid Import. `e2e/visual-contrast.spec.ts` checks the width at 640 and 700 px. |
| 1.4.5 Images of Text | AA | Pass | The only raster image is the badge logo. |
| 1.4.10 Reflow | AA | Pass | No sideways scrolling at 320 px on any sampled page. The grid becomes a list of roles per contributor. The element's heatmap scrolls inside its own box, which the exception for data visualisations allows. |
| 1.4.11 Non-text Contrast | AA | Pass | Fixed: the reorder grip, text-field edges and empty grid cells were 1.1 to 1.6:1. `e2e/visual-contrast.spec.ts` checks them at 3:1 in both themes. Focus rings measure 7.5 to 9.2:1. |
| 1.4.12 Text Spacing | AA | Pass | With the 1.4.12 spacing applied, no text is clipped or overlaps. |
| 1.4.13 Content on Hover or Focus | AA | Pass | Fixed: Escape did not hide the census chart's value readout. `e2e/focus-and-timing.spec.ts` checks it. Popovers open on click and close on Escape. |

### Operable

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 2.1.1 Keyboard | A | Pass | Every task done with the keyboard alone: draft, import, export, reorder, reply as a co-author. |
| 2.1.2 No Keyboard Trap | A | Pass | Tab walks leave every page and dialog; every popover closes on Escape and returns focus. |
| 2.1.4 Character Key Shortcuts | A | Pass | The 0 to 3 keys act only on a focused grid cell. |
| 2.2.1 Timing Adjustable | A | Pass | Fixed: the bulk-change Undo left after 8 s. Every Undo now stays 60 s; `e2e/focus-and-timing.spec.ts` checks it. |
| 2.2.2 Pause, Stop, Hide | A | Pass | No moving or auto-updating content; animations are short and one-off. |
| 2.3.1 Three Flashes or Below Threshold | A | Pass | Nothing flashes. |
| 2.4.1 Bypass Blocks | A | Pass | "Skip to content" on every page, plus skip links to the grid and statement. |
| 2.4.2 Page Titled | A | Pass | Each page has its own title. The co-author page shares the app's title. |
| 2.4.3 Focus Order | A | Pass | Source order everywhere. Dialogs and popovers return focus to their opener, or to the main content when there is none. |
| 2.4.4 Link Purpose (In Context) | A | Pass | Every link name read on the about, statement and census pages. |
| 2.4.5 Multiple Ways | AA | Pass | The header navigation and links in the content reach every page. |
| 2.4.6 Headings and Labels | AA | Pass | Headings and labels name their content: every name in the accessibility tree of each sampled surface was read. Fixed: the co-author page had one heading for 14 roles; each role now has its own. Each Undo now sits in a group named by what it undoes. |
| 2.4.7 Focus Visible | AA | Pass | Every stop in a 400-stop Tab walk changed visibly. The contributor name field now has its own ring as well. |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Pass | Fixed: on phones, focus moving up the role list went under the sticky bar, and the status banner covered focused fields. `e2e/focus-and-timing.spec.ts` checks both. |
| 2.5.1 Pointer Gestures | A | Pass | No multi-point or path gestures. |
| 2.5.2 Pointer Cancellation | A | Pass | Fixed: pressing a dialog's backdrop closed it before release. `e2e/focus-and-timing.spec.ts` checks it. |
| 2.5.3 Label in Name | A | Pass | The visible text is part of the accessible name on every control checked (195). |
| 2.5.4 Motion Actuation | A | N/A | No motion input. |
| 2.5.7 Dragging Movements | AA | Pass | Reordering has Move up and Move down; files can be picked with Browse. |
| 2.5.8 Target Size (Minimum) | AA | Pass | Targets under 24 px meet the spacing or inline-link exception. |

### Understandable

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 3.1.1 Language of Page | A | Pass | `lang` is right on every page in all nine languages, also after switching. |
| 3.1.2 Language of Parts | AA | Pass | The statement, role popovers, the English-only statement page and the element's English messages carry their own `lang`. |
| 3.2.1 On Focus | A | Pass | Focus alone opens nothing and changes no page. |
| 3.2.2 On Input | A | Pass | Changing a setting changes no page and moves no focus. |
| 3.2.3 Consistent Navigation | AA | Pass | The header is the same, in the same order, on every page. |
| 3.2.4 Consistent Identification | AA | Pass | The same function has the same name everywhere. |
| 3.2.6 Consistent Help | A | Pass | "How it works" is in the same place on every page. |
| 3.3.1 Error Identification | A | Pass | Fixed: four fields rejected input without a message, or hid it after 4 s. `e2e/input-errors.spec.ts` checks each. |
| 3.3.2 Labels or Instructions | A | Pass | Every field has a name, and formats are stated. |
| 3.3.3 Error Suggestion | AA | Pass | Errors say what to change. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | Pass | Removals and bulk changes can be undone; replacing the workspace and deleting drafts ask first. |
| 3.3.7 Redundant Entry | A | Pass | The co-author page and imports fill in what is already known. |
| 3.3.8 Accessible Authentication (Minimum) | AA | N/A | Nothing needs a login. The optional ORCID sign-in is ORCID's own page. |

### Robust

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 4.1.2 Name, Role, Value | A | Pass | Fixed: popover panels were dialogs without a name. `e2e/a11y.spec.ts` now runs axe's `aria-dialog-name` rule on them. Each popover's button reports it open, and focus returns to it on Escape; each grid cell names its level, and radios, tabs and switches report their state (`e2e/screen-reader.spec.ts`, also in Firefox and WebKit). Screen-reader check still to do. |
| 4.1.3 Status Messages | AA | Pass | Fixed: picking a file in the import dialog announced nothing; `e2e/input-errors.spec.ts` checks it. Fixed: the Undo strip appeared with its text already in it, which many screen readers miss, and removing a contributor relied on it alone; a bulk change was said twice; and every grid change also read out the statement's counts. Each message now goes once through a live region that is already on the page, which `e2e/screen-reader.spec.ts` checks from a log of every live-region change. Screen-reader check still to do. |

WCAG 2.2 removed 4.1.1 Parsing, so it is not listed.

## Summary

Of the 55 level A and AA criteria, none fails, 47 pass and 8 do not apply. The 26 October pass
read what a screen reader is given and ran the main checks in Firefox and WebKit; it changed no
result, but fixed four problems behind 1.3.1, 2.4.6 and 4.1.3. The statement still says "partially
conformant": this is a self-assessment of a sample, not an audit, and no screen reader has read the
app. Next: a screen-reader pass with NVDA and Firefox, and VoiceOver and Safari, which may change
the rows that say so.
