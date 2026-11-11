---
# Mirrors the tokens defined in src/app/globals.css, which is the source of
# truth for anything the app renders. Change a value there first, then here.
name: CRediT Matrix
description: A precise editorial workspace for scholarly contribution statements.
colors:
  ink-blue: "#1f4e79"
  ink-blue-hover: "#183f62"
  ink-blue-soft: "#d6e2ee"
  # The page is paper tinted 3% toward the draft's heatmap colour (4% in dark mode).
  paper: "#fbf8f1"
  paper-bright: "#fffdf8"
  paper-muted: "#f5f0e6"
  graphite: "#2e2a25"
  graphite-muted: "#5e584e"
  rule: "#d6ccba"
  edge: "#2e2a25"
  error: "#ba1a1a"
  flag: "#b45309"
typography:
  headline:
    fontFamily: "Newsreader, Georgia, serif"
    fontWeight: 600
    lineHeight: 1.2
  manuscript:
    # The statement: the text that goes into the paper, a step up from body.
    fontFamily: "Newsreader, Georgia, serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.625
  body:
    fontFamily: "Atkinson Hyperlegible Next, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Atkinson Hyperlegible Next, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 600
  micro:
    fontFamily: "Atkinson Hyperlegible Next, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.625rem"
    fontWeight: 500
  caption:
    fontFamily: "Atkinson Hyperlegible Next, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
  data:
    fontFamily: "Atkinson Hyperlegible Next, IBM Plex Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 500
  mono:
    fontFamily: "Atkinson Hyperlegible Mono, IBM Plex Mono, ui-monospace, monospace"
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
    rounded: "{rounded.md}"
    padding: "10px 20px"
  card:
    backgroundColor: "{colors.paper-bright}"
    textColor: "{colors.graphite}"
    rounded: "{rounded.md}"
    padding: "16px"
  contributor-chip:
    # With colour by contributor, the chip is that person's hue with white
    # initials. Otherwise it is a 10% tint of ink-blue, not the flat
    # ink-blue-soft token, so it keeps its relationship to the chosen grid
    # colour. Height is fixed and the glyph is centred, so only the inline
    # padding is specified.
    backgroundColor: "{colors.ink-blue} @ 10%"
    textColor: "{colors.ink-blue}"
    rounded: "{rounded.sm}"
    padding: "0 6px"
---

# Design System: CRediT Matrix

## Overview

The interface looks like a working document: scholarly, compact, and sure of itself. Warm paper,
ink edges and a book-like serif give it the feel of a typeset page. The serif gives the manuscript
output weight, and a hyperlegible sans-serif keeps the controls practical.

This is a workspace, not a marketing page. Its character comes from the visible flow from the
contributors, through the matrix, to the text for the manuscript.

## Colors

Use warm paper neutrals throughout the interface. Ink is a warm charcoal, not near-black: it keeps
13:1 on paper without the weight of black. The page itself is paper tinted 3% toward the
draft's heatmap colour (4% in dark mode), so it shifts to a faint sage when someone picks green and
stays neutral for grey. With colour by contributor no single hue is drawn, so the page stays plain
paper. The tint stops at those values because a custom colour can be anything, and
the muted text must keep 4.5:1 on it. It is for the web interface only: an exported figure is always
drawn on white. Cards and the statement sit on the page in brighter paper.

Reserve ink blue for primary actions, links and focus outside the grid. The heatmap hue is also
the accent (`--color-accent`, set by `ThemeHue`): the wordmark, the initials chips, the selected
segment, the active inspector tab and focus inside the grid. In light mode it is deepened toward
black, and in dark mode lightened toward white, only as far as it takes to reach 4.5:1 against bright
paper both ways, so any custom colour stays legible. With colour by contributor the accent is ink
blue. Use contributor colors only to identify data.

By default the grid colours each contributor in their own hue, by list position: their chip, the
rule under their column name, their cells, and the mark on their phrase in the statement all share
it. The eight hues in `CONTRIBUTOR_HUES` (`src/core/contributor-color.ts`) differ in hue and
lightness, and each carries white initials at 4.5:1 or more. A person is also named by their column,
so colour is never the only cue. Past eight contributors two people would share a hue, so the grid
falls back to the draft's one hue. Choosing a heatmap colour also switches to one hue, because that
is what the person asked to see. Colour by contributor is a display option, saved per draft beside the
heatmap colour.

Ink blue does not reach a 3:1 contrast against muted paper text, so a link inside a sentence is
underlined as well as colored. A link on a line of its own may stay plain until hovered.

The heatmap levels must stand out more from Supporting to Lead, in both themes. In light mode the
fill mixes the chosen hue with white (40%, 70%, 100% of the hue). On a dark page that scale looks
upside down, so dark mode keeps the hue and raises its lightness instead: 30%, 48% and 77% (for ink
blue `#1f4f7a`, `#327ec3`, `#a2c6e7`), with dark marks on Lead. Exported heatmaps always use the
light scale on a white background, because a figure goes onto a manuscript page. A figure draws
what the grid draws: one hue, or with *Per contributor* each person's hue for slides and posters,
with the level key in a neutral grey. The preview says so when it is per contributor, because one
hue is the safe choice for greyscale print and any journal's style. Figure cells default
to square corners and a thin neutral rule; the live editing controls retain their rounded corners. `heatCellColor` in
`src/core/contributor-color.ts` holds both scales.

The editor uses one, two and three dots for Supporting, Equal and Lead, and a check in yes/no mode.
Publication figures omit these marks by default to keep the matrix quiet. Optional marks repeat
in the cells and legend as an additional way to distinguish levels. Keep the editor's key directly
after the table. Figure legends use a vertical key beside tall narrow grids when it fits without
excessive width, otherwise a wrapped key below. Allow Right, Below and Hidden overrides. The heatmap export popover previews the actual figure
on white paper, with fit-to-width and actual-size views and the PNG pixel dimensions.

Figure settings belong beside that preview and are saved per draft, independently of contribution
values. Colour, orientation and initials are stored once per draft and drawn by both the grid and
the figure. Both panels render the same component for them (`GridViewSettings`): the grid's Heatmap
options, and the top of Figure settings under "Shared with the grid", since choosing them is part
of preparing a figure and the preview shows the result. Below it, "This figure only" holds legend,
role labels, empty roles, levels and marks, with font and cell geometry under Advanced. Short role labels stay a figure
option: the grid has room for the full names and their definitions, and a statement must use the
official CRediT terms. Figure settings' Reset restores the figure's own options and leaves the shared ones. On a narrow screen, settings
replace the preview until the person closes them; desktop shows both side by side.
Keep export recipes behind a disclosure in Figure settings. Show a selectable snippet and copy
action for the chosen document tool, with any differences from the preview beside the snippet.

The requested width sets the PDF page size and, with resolution, PNG pixel dimensions and
print-density metadata. Show the resulting dimensions, flag labels that would print very small,
and keep SVG available when a PNG would exceed the raster size limit. SVG and PDF retain vector
geometry and embed the selected sans or serif fonts. See the [figure font guide](integrations/figures/README.md)
for receiving-editor limits.

Flag amber marks where a co-author answered differently: the corner mark on a grid cell, the ring
around the cell a Review line points at, and the ring that fades off a cell when you settle a
difference. It is a mark, never a fill, and it always comes with a shape or text.

## Typography

Use Newsreader, with Georgia as the fallback, for the brand, section headings, and manuscript
output. Keep manuscript text upright, and use italics only for short accents, such as the *Role*
axis title. Use Atkinson Hyperlegible Next for controls and explanations, and Atkinson Hyperlegible
Mono for contributor initials, counts and short data labels. Atkinson covers Latin scripts only;
IBM Plex Sans and Mono stand behind it for Cyrillic, Greek and Vietnamese names. The
`… Fallback` faces in `fonts.css` are local fonts with adjusted metrics, so text does not shift
while the web fonts load; they are not part of the type scale.

Write labels and headings in sentence case. Never set a label in letterspaced capitals: a section
gets a Newsreader heading, a control group gets a short semibold label.

## Brand

The mark (the logo) is a 3×3 crop of the contribution matrix, with lead on the diagonal. It is
drawn on a 32px grid with 8px cells and 1px gaps. Its fills are the heatmap's real levels, not
decorative tints, so the mark looks like the product's own data.

Draw the mark in `currentColor` wherever it sits beside text, as it does in the header lockup. With
colour by contributor each column of the mark takes one contributor's hue, as the grid's columns do. Where
it stands alone, use the ink-blue levels themselves. The lockup is the mark at cap height, then a
gap, then the wordmark (the name set as type) in Newsreader italic. Never letterspace the wordmark.
It takes the accent: the mark's hue where that carries text, deepened where it does not, so the
mark and the wordmark read as one colour.

The wordmark never wraps and never shrinks to fit. Draw it only where you have measured that the
row is wide enough, and below that let the mark show the brand alone. Wherever the wordmark is not
drawn, still give the name in text: the mark is decorative, so without the name the heading has no
accessible name.

`docs/brand/` holds the sources for the exported PNG assets and the command that renders them again.

## Layout

The grid is the canvas. From `xl` up, the contributor list is a slim rail on the left that folds to
initials. The grid fills the middle. An inspector on the right holds four tabs: Statement, Team,
Review and Published practice. Published practice is reference beside the grid, not a step: a table
of how often published papers in a field give each role per author position, with a thin bar under
each value. It never fills, suggests or flags a cell, so it stays neutral: bars in on-surface-variant
and the user's column in a surface tint with a "You" label, never primary. A status strip above the
grid says what the draft is waiting for; until someone answers, that is a labelled "Ask co-authors"
tool button with the send icon, not a link, since it is the draft's next step. It also holds the controls
that change the whole grid (Yes/No vs Levels, bulk assign, display options, heatmap export). Below
`xl` the same parts stack in that order: rail, strip, grid, inspector. On a phone the grid becomes a
list of roles per contributor.

The three panes share one page: no pane backgrounds and no rules between them on a wide screen. The
contributor cards and the statement sit directly on the tinted page, so the matrix reads as the sheet
they are cut from. Sticky table headers paint the page colour, so they stay opaque while the grid
scrolls under them. Stacked below `xl`, a thin rule separates the parts.

Never give the statement a full-width row. Its text is capped at 75ch, so in a wide column it wraps
at half the width and leaves the rest empty. Keep the rail and the inspector at fixed widths, and
give the grid what is left. The table is as wide as its content and is centred in its pane, with
the status strip and the level key aligned to its left edge. The strip ends at the grid's edge, so
its controls stay beside the grid they change. A short contributor list leaves equal paper on both
sides of the block, and a long one gets every column the screen can show.

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

After that, a one-line "Getting started" checklist heads the status strip: tick roles, ask
co-authors, copy the statement. It ticks itself from the draft, never from a Next button, and the
next step's control (Ask co-authors, Copy statement) carries a ring in the accent that pulses three
times and then holds; under reduced motion it only holds. It never takes focus or blocks the page,
and it is gone for good once every step is done or it is closed.

On touch, every control takes a 44px tap. Grow a small control's tap area with the `hit-area`
class rather than its size, so the desktop density stays. On a phone the picker for the
contributor carries their live statement line, which links down to the full statement.

## Elevation and depth

Elevation is a hard offset, never a blur: a card sits on the page like a paper cut-out. Use the
shadow tokens, which all have zero blur: `shadow-card` (2px, a contributor card on hover, a tool
button on hover), `shadow-press` (2px in the ink edge, the primary button), `shadow-float` (4px,
popovers and menus over the content) and `shadow-sheet` (5px, tinted ink blue, the statement: the
result of the work). Pair a 1px ink edge (`edge`) with a hard shadow, never with a soft one. Lines
inside a card stay thin and neutral (`rule`).

Forced colours drop every shadow, so a surface that floats keeps a real 1px border, and focus
falls back to a `Highlight` outline. Filled level marks keep their own colours there, since the
mark is contrast-checked against its fill.

## Shapes

Corners are small: 2px for document details, chips and cells, 4px for controls, cards and
popovers. The segmented control is square-cornered, with the selected option filled in the accent.
Keep pill shapes for status, switches and small markers.

## Components

### Buttons

Primary buttons use ink blue with bright paper text and the press shadow, and a darker opaque ink
blue on hover (`ink-blue-hover`), never a translucent tint that lets the text fade. Secondary
buttons use the 1px ink edge on bright paper and lift with the card shadow on hover. Give every control a visible keyboard focus and a target of at least
24px.

Keep one primary action per view: Copy statement. The header actions (Share, Import) are secondary.
Share holds both ways of sending the draft to people, the usual one first: asking each co-author to
check their own column (it opens the Team tab), then copying a link to the whole draft.
A disabled button loses its fill and its shadow, and mutes its text and outline, so it never looks
like a faded working primary button.

### Cards and containers

Cards use bright paper, 4px corners and a thin warm outline; on hover the outline turns to the ink
edge and the card shadow appears. The statement is the one sheet: ink edge, 2px corners and the
sheet shadow. Use spacing or a divider instead of a card inside a card.

### Inputs and fields

Fields use bright paper with the 1px ink edge. Use a visible focus style. Keep error text and
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

### Settings panels

The grid's view options, Figure settings, the statement options and the language popover share
one vocabulary, built from `src/components/ui/settings-panel.tsx`. A panel opens with its title in
`text-sm` semibold and a text Reset on the right. Sections have a short semibold label in sentence
case, never letterspaced capitals, and a rule (`border-outline-variant/40`) between them. An on/off
setting is a switch on the right with its label on the left; the whole row is the label. Two or three
short options are a small segmented control with a label. A segmented control outside a panel is a
mode that changes what the area beside it does (Yes / no or Levels, By author or By role) and stands
36 px tall like the toolbar buttons next to it; four or more, or long labels, are a select.
Numbers keep the figure number field. Colour is one row of swatches: *Per contributor* first (a
conic gradient of the contributor hues), the preset hues, then *Custom*. A pressed swatch shows a
ring and a check, and the chosen one is named beside the label. Small popovers are `w-72`; Figure
settings keeps its 15rem column.

### Contribution matrix

Use the matrix on larger screens, and a list of roles per contributor on narrow screens. Keep role
and contributor labels visible while you scroll. Show each selected value with color, a mark, an
accessible label, and in the exported data. Keep bulk assignment behind a toggle that you open
first.

An empty cell has no fill and no ring: a 3px dot in `outline-strong` (3:1 on the page) marks it, so
the filled cells carry the grid. Hover and focus draw the whole target. The key under the grid is
a row of swatches drawn as cells are (None as the empty cell's dot), 2px apart, from None to Lead,
each labelled in plain text under it. It starts at the grid's left edge, never centred under the
lopsided table. With colour by contributor
the scale is neutral, and while a cell or phrase is linked it redraws in that person's hue.

Column headers show full names at 50°. They switch to initials past 20 columns, or when the person
asks for initials. Under each name, a glyph with a spoken label says where that person stands: a
dash for not asked, a clock for asked, a count of open differences that opens Review, a double
check for settled, or "You" for your own column. The role name itself opens the role's description,
so there are no separate info buttons. Role names are not in the tab order. Instead you reach them
with the grid's arrow keys, so the whole matrix is one tab stop. The key hint under the legend is
always visible where there is a mouse or trackpad, and hidden under `pointer: coarse`, where there
are no keys to press; it stays the grid's accessible description either way.

Pointing at a cell with a mouse, or focusing it, marks its phrase in the statement: the phrase is
underlined as well as tinted, on the same element it always renders, so a selection being dragged
holds. Pointing at a phrase rings its cell. With colour by contributor, both marks are in that
person's hue: the phrase tinted and underlined in it, and the cell given an ink edge and a hard
shadow in it. Nothing moves and nothing is announced. The
status strip counts answers only once someone has been asked; when every co-author but you has been
asked and has answered, and nothing is left to review, the count becomes the double check and
"Everyone agreed".

### People and roles

A person and a role each act the same way on every surface that shows them. Pointing at a person
(their list row, the grid's name header, their name in the statement) marks them everywhere; pointing
at a role (the grid's role label, a role's name in a by-role statement) marks that role. Pointing
at a phrase or a cell marks that one cell. Hover is mouse only and never opens anything.

Clicking opens one panel per object. A person opens the person menu: move up or down, this is me,
equal contribution, corresponding, ask links, add ORCID iD, set all roles (it asks which level) and
clear all roles; the grid and the statement add Edit in list, which focuses the name field in the
list. In the list only the "…" button opens it, since the name itself is a text field. A role opens
its popover: the description and the full definition, then Assign to everyone (it asks which level)
and Clear for everyone. Both bulk actions share the undo strip under the grid. A click on a phrase
in the statement goes to its cell and makes that cell the grid's tab stop. The name and role
headers are not in the tab order; the grid's arrow keys reach them. In the statement, names, roles
and phrases stay text, not buttons: a click there is a pointer shortcut to a panel the keyboard
reaches from the list's "…" or the grid's headers, so the statement never reads as a row of buttons
or fills the tab order. Frozen rows disable the items that edit them.

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
