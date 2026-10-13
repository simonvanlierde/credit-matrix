# Accessibility statement

CRediT Matrix ([credit.duinlab.nl](https://credit.duinlab.nl)) aims to meet
[WCAG 2.2](https://www.w3.org/TR/WCAG22/) at level AA, and through it the web requirements of
[EN 301 549 v4.1.1](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/04.01.01_60/en_301549v040101p.pdf).
It has not been audited, so this is a goal, not a claim that it conforms.

Last reviewed: 13 October 2026.

## How it is checked

- **Automated scan.** The end-to-end tests run [axe-core](https://github.com/dequelabs/axe-core)
  over the main screens with the WCAG 2.0, 2.1 and 2.2 level A and AA rules (`wcag2a`, `wcag2aa`,
  `wcag21a`, `wcag21aa`, `wcag22a`, `wcag22aa`). The screens include the welcome dialog, the empty
  and filled workspace, a phone-sized screen, the import dialog, an error state, an open popover
  and dark mode. See [`e2e/a11y.spec.ts`](../e2e/a11y.spec.ts).
- **Keyboard tests.** The same tests use the keyboard alone to move through the contributor list,
  reorder a contributor without dragging, switch the inspector tabs, move through the grid with
  the arrow keys and use the segmented controls. They also check that focus stays in place after a
  contributor is removed, and that small icon buttons are big enough to hit.
- **Lint.** [Biome's accessibility rules](https://biomejs.dev/linter/rules/#accessibility) check
  every change for things like missing alt text, invalid ARIA and click handlers without a
  keyboard equivalent.

All of this runs on every pull request. Automated tools find only part of the problems a person
can run into, so a passing run does not mean there are none.

## Known limitations

- **No testing with assistive-technology users yet.** Nobody who relies on a screen reader,
  switch access or voice control has tested the app. Screen-reader support is built in (labels,
  landmarks, live announcements), but only checked by the automated tools above.
- **One browser engine in the tests.** The automated tests run in Chromium only. Firefox and
  Safari are not tested automatically.
- **Machine-made translations.** Beside English, the interface is available in eight languages
  (German, Spanish, French, Italian, Japanese, Dutch, European Portuguese and Simplified Chinese).
  These translations were made by machine and have not been reviewed by native speakers, so some
  wording may be unclear. The CRediT role names themselves come from the reviewed
  [credit-translation](https://github.com/contributorshipcollaboration/credit-translation) project.
- **This statement is in English only.**
- **Heatmap images.** The downloaded SVG carries a title that screen readers read. A PNG cannot
  carry one, so when you put the heatmap in a paper or slide, add your own alt text there.

## Report a problem

If something in the app is hard or impossible for you to use, please
[open an issue on GitHub](https://github.com/simonvanlierde/credit-matrix/issues/new). Say what you
were trying to do, what happened, and which browser and assistive technology you use, if any.
