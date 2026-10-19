---
# Mirrors the tokens defined in src/app/globals.css, which is the source of
# truth for anything the app renders. Change a value there first, then here.
name: CRediT Matrix
description: A precise editorial workspace for scholarly contribution statements.
colors:
  ink-blue: "#1f4e79"
  ink-blue-hover: "#183f62"
  ink-blue-soft: "#d6e2ee"
  paper: "#fafaf9"
  paper-bright: "#ffffff"
  paper-muted: "#f4f4f2"
  graphite: "#16181c"
  graphite-muted: "#595c63"
  rule: "#c9c9c5"
  error: "#ba1a1a"
  flag: "#b45309"
typography:
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontWeight: 600
    lineHeight: 1.2
  body:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 600
    letterSpacing: "0.08em"
  micro:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
  caption:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
  data:
    fontFamily: "IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
  mono:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
rounded:
  sm: "2px"
  md: "4px"
  lg: "8px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.ink-blue}"
    textColor: "{colors.paper-bright}"
    rounded: "{rounded.lg}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.lg}"
    padding: "16px"
  contributor-chip:
    # A 10% tint of ink-blue rather than the flat ink-blue-soft token, so the
    # chip keeps its relationship to the chosen grid color. Height is fixed and
    # the glyph is centred, so only the inline padding is specified.
    backgroundColor: "{colors.ink-blue} @ 10%"
    textColor: "{colors.ink-blue}"
    rounded: "{rounded.md}"
    padding: "0 6px"
---

# Design System: CRediT Matrix

## Overview

The interface looks like a working document: scholarly, compact, and quiet. A book-like serif gives
the manuscript output weight, and a sans-serif keeps the controls practical.

This is a workspace, not a marketing page. Its character comes from the visible flow from the
contributors, through the matrix, to the text for the manuscript.

## Colors

Use warm paper neutrals throughout the interface. Reserve ink blue for primary actions, links,
focus, and selected states. Use contributor colors only to identify data.

Ink blue does not reach a 3:1 contrast against muted paper text, so a link inside a sentence is
underlined as well as colored. A link on a line of its own may stay plain until hovered.

The heatmap levels must stand out more from Supporting to Lead, in both themes. In light mode the
fill mixes the chosen hue with white (40%, 70%, 100% of the hue). On a dark page that scale looks
upside down, so dark mode keeps the hue and raises its lightness instead: 30%, 48% and 77% (for ink
blue `#1f4f7a`, `#327ec3`, `#a2c6e7`), with dark marks on Lead. Exported heatmaps always use the
light scale, because a figure goes onto a white page. `heatCellColor` in
`src/core/contributor-color.ts` holds both scales.

Flag amber marks where a co-author answered differently: the corner mark on a grid cell, the ring
around the cell a Review line points at, and the ring that fades off a cell when you settle a
difference. It is a mark, never a fill, and it always comes with a shape or text.

## Typography

Use Newsreader, with Georgia as the fallback, for the brand, section headings, and manuscript
output. Keep manuscript text upright, and use italics only for short accents. Use IBM Plex Sans for
controls and explanations. Use IBM Plex Mono for contributor initials and short data labels.

## Brand

The mark (the logo) is a 3×3 crop of the contribution matrix, with lead on the diagonal. It is
drawn on a 32px grid with 8px cells and 1px gaps. Its fills are the heatmap's real levels, not
decorative tints, so the mark looks like the product's own data.

Draw the mark in `currentColor` wherever it sits beside text, as it does in the header lockup. Where
it stands alone, use the ink-blue levels themselves. The lockup is the mark at cap height, then a
gap, then the wordmark (the name set as type) in Newsreader italic. Never letterspace the wordmark,
never color it other than the primary token, and never give the mark and the wordmark different
colors.

The wordmark never wraps and never shrinks to fit. Draw it only where you have measured that the
row is wide enough, and below that let the mark show the brand alone. Wherever the wordmark is not
drawn, still give the name in text: the mark is decorative, so without the name the heading has no
accessible name.

`docs/brand/` holds the sources for the exported PNG assets and the command that renders them again.

## Layout

The grid is the canvas. From `xl` up, the contributor list is a slim rail on the left that folds to
initials. The grid fills the middle. An inspector on the right holds three tabs: Statement, Team and
Review. A status strip above the grid says what the draft is waiting for. It also holds the controls
that change the whole grid (Yes/No vs Levels, bulk assign, display options, heatmap export). Below
`xl` the same parts stack in that order: rail, strip, grid, inspector. On a phone the grid becomes a
list of roles per contributor.

Never give the statement a full-width row. Its text is capped at 75ch, so in a wide column it wraps
at half the width and leaves the rest empty. Keep the rail and the inspector at fixed widths, and
give the grid what is left. The table is as wide as its content and centered in the grid's space. A
short contributor list sits in calm margins, and a long one gets every column the screen can show.

In a desktop-sized window the workspace is locked to the window's height. The page itself doesn't
scroll; each pane scrolls its own content. Only lock the height when both halves of the `desk` guard
hold: ≥80rem wide **and** ≥45rem tall. A short window, a zoomed page, or a phone held sideways needs
the page to scroll as normal.

If a pane scrolls but holds nothing you can focus, give it a tab stop. Otherwise keyboard users
can't scroll it.

A panel that opens from a control belongs in a popover, not in a box placed by hand with absolute
positioning. A popover closes on a click outside it and on Escape, renders outside any parent that
scrolls, and reports whether it is open, so the control that opened it can show that.

When a row's content changes with a mode, the row must not shift under the visitor's next click.
Pin the elements that sit against an edge. Let the part
whose length varies wrap inside its own share of the row. Use `w-0 min-w-full` so that a row whose
width varies does not set the width of a `max-content` column.

## Density

This is a screen to work on, not to read. On a standard 1080p desktop screen you should see the
whole workflow at once, without scrolling the page. Spend height on contributor rows and matrix
rows, and take it from the frame around them. Give a list that can grow without limit (contributors,
validation checks) a maximum height, so it can't push the workflow off the screen.

The first-run help sits over the workspace, not in a band of its own, which would take that
height for good and shift the page when closed.

## Elevation and depth

Use paper surfaces in slightly different tones, and thin neutral lines. Give work cards a low
shadow, and the generated result a slightly stronger one.

## Shapes

Use 2–4px corners for document details and 8px corners for controls and cards. Use pill shapes
only for status, segmented controls, switches, and identity markers.

## Components

### Buttons

Primary buttons use ink blue with bright paper text, and a darker opaque ink blue on hover
(`ink-blue-hover`), never a translucent tint that lets the text fade. Secondary buttons use a quiet outline and a
paper or transparent fill. Give every control a visible keyboard focus and a target of at least
24px.

Keep one primary action per view: Copy statement. The header actions (Share, Import) are secondary.
A disabled button loses its fill and mutes its text and outline, so it never looks like a faded
working primary button.

### Cards and containers

Cards use bright paper, 8px corners, a thin outline, and a low shadow. Use spacing or a divider
instead of a card inside a card.

### Inputs and fields

Fields use bright or muted paper with quiet lines. Use a visible focus style. Keep error text and
inactive text readable, and say how to fix the problem.

### Navigation

Keep the brand and the global actions in the fixed header. On narrow screens, use icons with
labels, and don't cut off or hide their accessible names.

Measure the header before you add to it. When a global link no longer fits, give it to the lockup,
so the product name opens what the product is, and show that with a chevron: without one, the
lockup looks like a title nobody taps. Never put such links behind an unlabeled icon while labeled
ones exist. The nav and the menu switch at the same width, so exactly one of them is on screen at a
time.

### Attribution

When a license asks for attribution, give it in the deployed app, not only in the repository. Name
the work, name its creator, and link the license
itself. Put the notice next to the control that takes the material off the page. Keep the project's
own copyright with the brand, not in the small print.

### Contribution matrix

Use the matrix on larger screens, and a list of roles per contributor on narrow screens. Keep role
and contributor labels visible while you scroll. Show each selected value with color, a mark, an
accessible label, and in the exported data. Keep bulk assignment behind a toggle that you open
first.

Column headers show full names at 50°. They switch to initials past 20 columns, or when the person
asks for initials. Under each name, a glyph with a spoken label says where that person stands: a
dash for not asked, a clock for asked, a count of open differences that opens Review, a double
check for settled, or "You" for your own column. The role name itself opens the role's description,
so there are no separate info buttons. Role names are not in the tab order. Instead you reach them
with the grid's arrow keys, so the whole matrix is one tab stop. The key hint under the legend is
always visible.

## Do and don't

### Do

- **Do** keep the link between input, roles, and output visible.
- **Do** use semantic tokens in both the light and the dark theme.
- **Do** explain specialist terms where the person has to decide.
- **Do** leave room for long names, translations, keyboards, and tap targets.
- **Do** ask which level a bulk action assigns. Defaulting to the strongest one overstates the
  claim.

### Don't

- **Don't** add ornamental gradients, glass effects, oversized marketing type, or unrelated accents.
- **Don't** use serif typography for dense controls or data labels.
- **Don't** hide core contribution features on small screens.
- **Don't** make color the only way to distinguish a matrix value, or a link from the prose it sits
  in.
