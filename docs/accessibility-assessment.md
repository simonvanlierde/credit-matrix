# WCAG 2.2 self-assessment

This is the evidence behind the [accessibility statement](accessibility.md).
It reviews the 55 level A and AA criteria of [WCAG 2.2](https://www.w3.org/TR/WCAG22/).
It is a developer self-assessment of sampled pages, not an external audit or a claim of full conformance.

- **Reviewed:** 12 November 2026, against merged main `aef0630` and the timing fixes described below.
- **Browsers:** Chromium, Firefox and WebKit in Playwright desktop profiles. WebKit testing does not replace testing Safari on Apple hardware.
- **Settings:** light and dark themes, phone and desktop viewports, plus targeted forced-colors and reduced-motion emulation.
- **Not tested:** NVDA, JAWS, VoiceOver, switch access or voice control. Real zoom and native color-picker checks cover Chromium on Linux only.
- **Earlier reviews:** October observations informed this review. Their counts of Tab stops and controls are not current measurements.

## Sample and method

The sample covers the welcome and import dialogs, empty and filled workspaces, contribution grid,
phone role list, inspector tabs, sampled popovers, heatmap settings and preview, and co-author reply page.
It also covers the census, about and accessibility pages, and the `<credit-matrix>` web element
on light and dark pages and at 320 CSS pixels.

Browser checks cover axe rules, accessibility-tree snapshots, live-region DOM messages, keyboard actions,
focus restoration, contrast, selected targets, and settings under forced colors and reduced motion.
Text-spacing checks apply line height 1.5, letter spacing 0.12em, word spacing 0.16em and paragraph spacing 2em.
They check page width and access to figure settings at 320, 375, 768 and 1440 CSS pixels.
These checks do not establish what a screen reader speaks or prove that every control works with every input method.

The implementation review checks semantics, language attributes, timer behavior, text alternatives and color calculations.
Current light-mode text uses `--color-on-surface: #45413a`.
`src/lib/theme-color.ts` derives a readable accent from a custom hue; browser and unit tests check the sampled backgrounds.

### Repeatable checks

Build and serve the production app before running the browser checks:

```sh
pnpm build
pnpm start --port 3437
```

In another terminal:

```sh
BASE_URL=http://localhost:3437 pnpm exec playwright test \
  e2e/a11y.spec.ts e2e/screen-reader.spec.ts e2e/focus-and-timing.spec.ts \
  e2e/visual-contrast.spec.ts e2e/input-errors.spec.ts e2e/about.spec.ts \
  e2e/accessibility-statement.spec.ts e2e/happy-path.spec.ts \
  e2e/heatmap-resilience.spec.ts e2e/text-spacing.spec.ts e2e/messages.spec.ts \
  e2e/browser-zoom.spec.ts --workers 3
```

On 12 November 2026, 456 distinct browser checks passed across the three engines, including targeted
reruns of the text-spacing and settings checks. Two additional Chromium zoom checks passed in the follow-up below.
`pnpm verify` passed 1,730 unit tests and 85 integration tests.

Firefox and WebKit clipboard workflows use an in-page clipboard substitute.
They exercise the app's handlers, not the browser's native clipboard integration.

### Additional checks

`e2e/browser-zoom.spec.ts` uses Chromium’s [browser zoom API](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-setZoom).
Its temporary extension and browser profile are removed after each test.
It verifies zoom 2, doubled pixel density and halved layout width, rather than changing the viewport alone.
Both light and dark checks passed: Import opens, figure settings remain reachable, the keyboard can download SVG,
and the reading pages fit at 200% zoom. The browser starts at 1440 × 1000 pixels, with a 720 CSS-pixel layout after zoom.
Firefox and Safari zoom behavior has not been checked.

A headed Chromium 156.0.8078.4 session on Linux checked the native color picker with the keyboard.
Space opened it; Tab reached its RGB fields. Enter applied a new color and returned focus to Custom.
Escape cancelled edits, preserved the previous color and returned focus. The committed color persisted after reload.
No screen reader was used for this check.
Other browsers and Windows/macOS color dialogs remain untested.

The public ORCID sign-in page was inspected in the same Chromium version without entering credentials or submitting a form.
Email/ORCID and password fields exposed accessible names and accepted focus; autocomplete was not disabled.
Synthetic paste events were not cancelled, and no CAPTCHA was visible on the initial page.
Actual paste, password-manager autofill, MFA, recovery and risk-triggered challenges were not checked.
This narrows the evidence gap without settling the complete authentication process.

### Timing corrections

The review reproduced two barriers: Undo expired after 60 seconds, and clipboard failures disappeared after two seconds.
Contributor-removal and bulk Undo now have no timer. Status banners stay until dismissed or replaced;
draft changes and clearing still invalidate draft-specific recovery. Clipboard failures stay until another copy attempt.
Tests first reproduced the disappearing controls or messages, then passed with these fixes.
A longer fixed timeout alone does not establish [2.2.1 Timing Adjustable](https://www.w3.org/TR/WCAG22/#timing-adjustable).

## Results

- **Checked:** the listed browser or source checks found no failure in the sample. This is not a criterion-wide conformance verdict.
- **Needs review:** the evidence does not settle the criterion.
- **N/A:** no applicable content or input method was found in the sample.

### Perceivable

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 1.1.1 Non-text Content | A | Checked | Grid controls expose contribution names and levels; the export preview has the statement as image alt text. Census charts have text and tables. SVG/PNG download metadata is checked by `screen-reader.spec.ts`; destination software may discard or ignore it. |
| 1.2.1 Audio-only and Video-only (Prerecorded) | A | N/A | No audio or video in the sample. |
| 1.2.2 Captions (Prerecorded) | A | N/A | No audio or video in the sample. |
| 1.2.3 Audio Description or Media Alternative (Prerecorded) | A | N/A | No audio or video in the sample. |
| 1.2.4 Captions (Live) | AA | N/A | No audio or video in the sample. |
| 1.2.5 Audio Description (Prerecorded) | AA | N/A | No audio or video in the sample. |
| 1.3.1 Info and Relationships | A | Checked | Accessibility-tree tests check sampled landmarks, headings, lists, table headers, tabs, radio groups and named dialogs, including the co-author page and web element. |
| 1.3.2 Meaningful Sequence | A | Checked | The sampled trees follow content order. Source review found no positive `tabindex` in the app. |
| 1.3.3 Sensory Characteristics | A | Checked | Reviewed instructions name controls and roles in words, rather than relying on location, shape or color alone. |
| 1.3.4 Orientation | AA | Checked | Source review found no orientation lock in CSS, scripts or the web manifest. |
| 1.3.5 Identify Input Purpose | AA | Checked | The co-author’s own name input has `autocomplete="name"`; contributor fields otherwise hold other people’s data. |
| 1.4.1 Use of Color | A | Checked | Contribution levels have dot marks and names. Text links are underlined; errors have text. Selected color swatches also have a checkmark and outline. |
| 1.4.2 Audio Control | A | N/A | No audio. |
| 1.4.3 Contrast (Minimum) | AA | Checked | `visual-contrast.spec.ts` checks sampled text, placeholders, primary actions and hover colors in both themes. `contrast.test.ts` and `ThemeHue.test.tsx` check palette and custom-accent calculations. |
| 1.4.4 Resize Text | AA | Checked | `browser-zoom.spec.ts` verifies real 200% Chromium zoom in both themes, including Import, keyboard access to settings/downloads and reading-page width. Firefox/Safari zoom and text-only resizing remain untested. |
| 1.4.5 Images of Text | AA | Checked | Reviewed controls use real text. Heatmap previews are data figures with statement alternatives; this does not assess accessibility after inserting an exported image into another document. |
| 1.4.10 Reflow | AA | Checked | `text-spacing.spec.ts` checks the four app routes down to 320 CSS pixels and access to figure settings. The phone grid becomes a role list; the web element keeps the drawing within a scroll box and supplies a separate accessible table. |
| 1.4.11 Non-text Contrast | AA | Checked | `visual-contrast.spec.ts` checks sampled field edges, grips, empty-cell marks, focus rings and swatch boundaries. It also checks real selection outlines under forced-colors emulation. |
| 1.4.12 Text Spacing | AA | Checked | `text-spacing.spec.ts` applies the specified spacing values, checks page width at four viewports and reaches the last figure download action. Other content combinations remain outside that sample. |
| 1.4.13 Content on Hover or Focus | AA | Checked | `focus-and-timing.spec.ts` checks Escape dismissal of the census value readout. Sampled popovers open by activation and close on Escape. |

### Operable

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 2.1.1 Keyboard | A | Checked | Browser tests exercise grid arrow keys, role help, tabs, segmented controls, contributor reordering and keyboard access to figure downloads. This is not a manual run of every task. |
| 2.1.2 No Keyboard Trap | A | Checked | Sampled dialogs and popovers close on Escape and restore focus; tab/grid navigation is covered by `a11y.spec.ts` and `screen-reader.spec.ts`. |
| 2.1.4 Character Key Shortcuts | A | Checked | The 0–3 contribution shortcuts act on a focused grid cell, not as global shortcuts. |
| 2.2.1 Timing Adjustable | A | Checked | The reproduced Undo and failure-message deadlines are removed. Focus/timing, status-banner and copy-status regressions check persistent recovery and failures. Timed copied/lookup-success cues retain the underlying result; external authentication timing is not assessed. |
| 2.2.2 Pause, Stop, Hide | A | Checked | Source review found short feedback animations rather than continuously moving or auto-scrolling content. Reduced-motion emulation covers sampled settings; cell-fill transitions remain. |
| 2.3.1 Three Flashes or Below Threshold | A | Checked | No flashing content was found in the reviewed components. No instrumented flash-frequency measurement was performed. |
| 2.4.1 Bypass Blocks | A | Checked | Skip links target the main content, grid and statement; sampled page trees expose main landmarks. |
| 2.4.2 Page Titled | A | Checked | Route tests check page titles. The co-author view uses the app’s title. |
| 2.4.3 Focus Order | A | Checked | Keyboard tests check focus after contributor removal, Undo, dialog closing and popover closing. Draft switches clear their recovery buffers. |
| 2.4.4 Link Purpose (In Context) | A | Checked | Reviewed links identify their destination from their text or surrounding content; sampled tree tests inspect the reading pages and census. |
| 2.4.5 Multiple Ways | AA | Checked | Header navigation and content links provide routes to the reading pages and census. |
| 2.4.6 Headings and Labels | AA | Checked | Sampled headings, field labels, role names and Undo groups are checked in `screen-reader.spec.ts`. |
| 2.4.7 Focus Visible | AA | Checked | Tests check sampled control focus rings and keyboard focus states. The historical 400-stop walk was not repeated. |
| 2.4.11 Focus Not Obscured (Minimum) | AA | Checked | `focus-and-timing.spec.ts` checks the phone role picker and status banner against focused controls; figure-download focus is checked under text spacing. |
| 2.5.1 Pointer Gestures | A | Checked | Reviewed tasks do not require multipoint or path-based gestures. |
| 2.5.2 Pointer Cancellation | A | Checked | Backdrop tests check dismissal on pointer release and cancellation when a press starts inside the dialog. |
| 2.5.3 Label in Name | A | Checked | Visible labels and accessible names are reviewed on sampled controls. The historical 195-control inventory was not repeated. |
| 2.5.4 Motion Actuation | A | N/A | No motion-actuated input. |
| 2.5.7 Dragging Movements | AA | Checked | Move up/Move down provide a non-dragging alternative for contributor order. Import has a file picker. |
| 2.5.8 Target Size (Minimum) | AA | Checked | `a11y.spec.ts` measures sampled compact controls. This is not a complete measurement of all targets and spacing exceptions. |

### Understandable

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 3.1.1 Language of Page | A | Checked | The interface-message tests exercise locale loading and document language. Reading pages retain their declared language. |
| 3.1.2 Language of Parts | AA | Checked | Source review and tree tests check language on statements, role content, the English accessibility page and web-element messages. |
| 3.2.1 On Focus | A | Checked | The tested focus paths do not trigger navigation or submit a form merely by receiving focus. |
| 3.2.2 On Input | A | Checked | Tested settings update the current view without navigating or unexpectedly moving focus. |
| 3.2.3 Consistent Navigation | AA | Checked | The shared layout keeps header controls in the same order across app routes. |
| 3.2.4 Consistent Identification | AA | Checked | Shared controls and translation keys keep the sampled repeated functions consistently named. |
| 3.2.6 Consistent Help | A | Checked | The shared header keeps How it works in the same position across routes. |
| 3.3.1 Error Identification | A | Checked | `input-errors.spec.ts` checks linked field errors and import feedback. Failed clipboard feedback now remains until another attempt. |
| 3.3.2 Labels or Instructions | A | Checked | Sampled inputs have labels; import and identifier fields supply instructions and format feedback. |
| 3.3.3 Error Suggestion | AA | Checked | Reviewed error messages name the problem and an available correction or retry. |
| 3.3.4 Error Prevention (Legal, Financial, Data) | AA | Checked | Removals, bulk changes and supported imports offer Undo; replacing a workspace and deleting drafts require confirmation. This does not assess legal or financial transactions. |
| 3.3.7 Redundant Entry | A | Checked | Imports and co-author reply links reuse known contributor information; the tests exercise those journeys. |
| 3.3.8 Accessible Authentication (Minimum) | AA | Needs review | Unsigned replies require no login. The initial ORCID sign-in page has named, focusable fields and does not disable autocomplete or cancel the tested paste events. The complete external authentication process remains unassessed. |

### Robust

| Criterion | Level | Result | Evidence |
| --- | --- | --- | --- |
| 4.1.2 Name, Role, Value | A | Checked | Axe and accessibility-tree checks inspect sampled names, roles, expanded/selected states, contribution levels and web-element semantics. Actual assistive-technology interaction remains untested. |
| 4.1.3 Status Messages | AA | Checked | `screen-reader.spec.ts` logs expected live-region DOM messages for sampled actions. It does not prove what a screen reader announces or whether speech is interrupted. |

WCAG 2.2 removed 4.1.1 Parsing, so it is not listed.

## Remaining work

- Test real screen-reader journeys with NVDA/Firefox and VoiceOver/Safari, including custom colors, grid changes, dialogs and exported figures.
- Extend actual browser zoom and native color-picker checks to Firefox and Safari, including Windows/macOS and assistive technology.
- Evaluate optional ORCID authentication against [3.3.8](https://www.w3.org/TR/WCAG22/#accessible-authentication-minimum), including actual clipboard/autofill assistance, MFA, recovery, later challenges and timing.
- Review translated labels with native speakers. Machine-translated interface text has not had that review.

The public statement remains partially conformant. Browser checks and source review leave the gaps above;
there is no independent audit or complete assistive-technology assessment.
