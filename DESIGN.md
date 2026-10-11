---
# Mirrors the tokens defined in src/app/globals.css, which is the source of
# truth for anything the app renders. Change a value there first, then here.
name: CRediT Matrix
description: A precise editorial workspace for scholarly contribution statements.
colors:
  ink-blue: "#1f4e79"
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

The interface resembles a prepared working document: scholarly, compact, and quiet. Editorial type
gives manuscript output authority, and the sans-serif interface keeps controls practical.

This is a workspace, not a marketing page. Its character comes from the visible flow from
contributors, through the matrix, to manuscript output.

## Colors

Use warm paper neutrals throughout the interface. Reserve ink blue for primary actions, links,
focus, and selected states. Use contributor colors only to identify data.

Ink blue does not clear 3:1 against muted paper text, so a link inside a sentence is underlined as
well as recolored. A link that owns its own line may stay quiet until hover.

The heatmap tiers must get more prominent from Supporting to Lead in both themes. In light mode the
fill mixes the chosen hue toward white (40%, 70%, 100% of the hue). That ramp reads inverted on a
dark page, where the palest cell is the brightest, so dark mode keeps the hue and raises its
lightness instead: 30%, 48% and 77% (for ink blue `#1f4f7a`, `#327ec3`, `#a2c6e7`),
with dark marks on Lead. Exported heatmaps always use the light ramp, since a figure goes onto a
white page. `heatCellColor` in `src/core/contributor-color.ts` holds both ramps.

Flag amber marks where a co-author answered differently: the corner mark on a grid cell, the
ring around the cell a Review line points at, and the ring that fades off a cell as a difference is
settled. It is a mark, never a fill, and always comes with a shape or text.

## Typography

Use Newsreader with Georgia fallback for identity, section headings, and manuscript output. Keep
manuscript prose roman and reserve italics for short accents. Use IBM Plex Sans for controls and
explanations. Use IBM Plex Mono for contributor initials and compact data labels.

## Brand

The mark is a 3×3 crop of the contribution matrix, lead on the diagonal. It is drawn on a 32px
grid with 8px cells and 1px gaps. Its fills are the heatmap's real intensity tiers, not decorative
tints, so the mark and the product's data speak the same language.

Use the mark in `currentColor` wherever it sits beside text (the header lockup does), and with
literal ink-blue tiers wherever it stands alone. The lockup is the mark at cap height, then a gap,
then the wordmark in Newsreader italic. Never letterspace or recolor the wordmark away from the
primary token, and never set the mark and the wordmark in different colors.

The wordmark never wraps and never shrinks to fit. A two-line brand spills out of the fixed
header, and a squeezed one stops being the wordmark: draw it only where the row measurably has the
width, and let the mark carry the brand alone below that. Wherever the wordmark is not drawn, say
the name anyway — the mark is decorative, so without it the heading has no accessible name.

`docs/brand/` holds the sources for the exported PNG assets and the command that re-renders them.

## Layout

The grid is the canvas. From `xl`, the roster is a slim rail on the left that folds to initials,
the grid fills the middle, and an inspector on the right holds three tabs: Statement, Team and
Review. A status strip above the grid says what the draft is waiting on and holds the controls that
change the whole grid (Yes/No vs Levels, bulk assign, display options, heatmap export). Below `xl`
the same parts stack in that order: rail, strip, grid (as the contributor-focused role list on a
phone), inspector.

Never give the statement a full-width row. Its prose is capped at 75ch, so a wide column wraps the
text at half its width and leaves the rest empty. Keep the rail and inspector at fixed widths and
give the grid what remains. The table is content-sized and centered in it, so a small roster sits
in calm gutters and a large one gets every column the screen can show.

On a desktop-sized window the workspace is height-locked to the viewport. The page itself doesn't
scroll; each pane scrolls its own content.

Height-lock only behind both halves of the `desk` guard: ≥80rem wide **and** ≥45rem tall. Without
the height half, a short window, a zoomed page, or a phone in landscape traps the app in a nested
scroller. Those windows need ordinary document flow.

Give a pane that scrolls but holds no focusable content a tab stop, or keyboard users can't reach
its overflow.

A panel anchored to a control belongs in a popover, not a hand-placed absolute box. A popover
dismisses on an outside click and on Escape, and portals out of any scrolling ancestor. It also
reports its open state, so the control that opened it can show that state.

A row whose content changes with a mode must not reflow when it does. Otherwise flipping the mode
moves controls the visitor was about to click. Pin the elements that anchor to an edge. Let the
variable-length part wrap inside its own share of the row. Keep a row of varying width out of a
`max-content` column's intrinsic sizing, with `w-0 min-w-full`.

Use a contributor-focused role list on narrow screens. Keep the desktop matrix in a bounded viewport
with sticky row and column labels.

## Density

This is a working surface, not a reading one. On a standard 1080p desktop viewport the whole
workflow should be visible at once, with no page scroll. Spend vertical space on contributor rows
and matrix rows, and take it back from chrome. Bound a list that grows without limit (contributors,
validation checks) rather than letting it push the workflow below the fold.

First-run guidance overlays the workspace rather than taking a band in the layout flow. An inline
band costs that height permanently, and reflows the whole page when dismissed.

## Elevation and depth

Use tonal paper surfaces and fine neutral rules. Give work cards a low shadow and the generated
result a slightly stronger one.

## Shapes

Use 2–4px corners for document details and 8px corners for controls and cards. Reserve pills for
status, segmented controls, switches, and identity markers.

## Components

### Buttons

Primary buttons use ink blue with bright paper text. Secondary buttons use quiet outlines and paper
or transparent fills. Give every control visible keyboard focus and a target of at least 24px.

Keep one primary action per view: Copy statement. Header actions (Share, Import) are secondary.
A disabled button drops its fill and mutes its text and outline, so it never reads as a live
primary at lower opacity.

### Cards and containers

Cards use bright paper, 8px corners, a fine outline, and low elevation. Use spacing or a divider
instead of nested cards.

### Inputs and fields

Fields use bright or muted paper with quiet rules. Use a visible focus style. Keep error and
inactive text readable, and explain how to recover.

### Navigation

Keep identity and global actions in the fixed header. On narrow screens, use labeled icons without
clipping or hiding accessible names.

Measure the header before adding to it. Where a global link no longer fits, give it to the lockup,
which is otherwise the one element up there with nothing to do: the product name opens what the
product is. Earn that with a chevron: an unmarked lockup reads as a title, and a title nobody
taps hides the link as thoroughly as a breakpoint does. Never park such links behind an unnamed
glyph while named ones exist. The nav and the menu share one boundary, so exactly one is ever on
screen.

### Attribution

A license that asks for attribution is satisfied in the deployed app, not only in the repository:
someone using the site never opens `LICENSE`. Name the work, name its creator, and link the license
itself. Put the notice beside the control that carries the material off the page, and keep the
project's own copyright with the identity rather than in the small print.

### Contribution matrix

Use the matrix on larger screens and a contributor-focused role list on narrow screens. Keep role
and contributor labels visible during scrolling. Show each selected value with color, a mark, an
accessible label, and exported data. Keep bulk assignment behind a disclosure.

Column headers show full names at 50°, and fall back to initials past 20 columns or when the
person asks for initials. Under each name, a glyph says whether that person has been asked (a
clock, a dash, or "You"), with a spoken label. The role name itself opens the role's description:
no separate info buttons. Role names sit outside the tab order and join the grid's arrow-key focus
instead, so the matrix stays one tab stop. The key hint under the legend is always visible.

## Do and don't

### Do

- **Do** preserve the visible relationship between input, assignment, and output.
- **Do** use semantic tokens across light and dark themes.
- **Do** define specialist terminology at the decision point.
- **Do** budget for long names, translations, keyboards, and tap targets.
- **Do** keep the desktop workflow inside one viewport, and let each pane scroll its own overflow.
- **Do** ask which level a bulk action assigns. Defaulting to the strongest one overstates the
  claim.

### Don't

- **Don't** add ornamental gradients, glass effects, oversized marketing type, or unrelated accents.
- **Don't** use serif typography for dense controls or data labels.
- **Don't** hide core contribution features on small screens.
- **Don't** make color the only way to distinguish a matrix value, or a link from the prose it sits
  in.
- **Don't** height-lock the workspace without a viewport-height guard. A zoomed or short window
  needs ordinary document flow.
