# Contribution heatmap figures

The app's SVG, PDF and PNG downloads, the CLI, and the document plugins draw square cells with a thin
neutral rule. Rotated headers keep names beside their columns. White paper, one hue, and three
increasing intensities distinguish Supporting, Equal and Lead. Empty cells stay light gray.
This follows the compact matrix layout of [latex-credits](https://ctan.org/pkg/latex-credits).

The SVG renderer is shared by the app, CLI, MyST, Sphinx and Quarto/Pandoc. Typst draws native
vector shapes with the same palettes and level fractions. Figures include the full contribution
statement as their text alternative, including levels even when axis labels are shortened.
Both renderers omit contribution marks by default. Enable `marks` for one, two and three dots
for Supporting, Equal and Lead, or checks in yes/no mode, in both cells and legend.
Marks give a second way to tell levels apart. Keep a text alternative or contribution table with
the figure when you share it. The editable grid keeps its marks. The app previews the exported
figure before copying or downloading, with fit-to-width and actual-size views and the PNG pixel
dimensions.

## Figure options

Use these names in every plugin. The JavaScript `buildHeatmapSvg` function uses `fontSize` for `font-size`, `legendPosition` for `legend-position`, and `acronyms` for `initials`. Other keys match.

| Option | Values | Default |
| --- | --- | --- |
| `color` | Three- or six-digit hex color; Typst takes a color value | Palette's base hue |
| `palette` | `blue`, `green`, `gray` | `blue` |
| `shape` | `square`, `rounded`, `circle` | `square` |
| `size` | Cell side: pixels in SVG, a length in Typst | `22`, or `14pt` in Typst |
| `font` | `sans`, `serif` | `sans` |
| `font-size` | 6–32 SVG pixels; 4.5–24 points in Typst | `10.5`, or `7.5pt` in Typst |
| `legend` | `true`, `false` | `true` |
| `legend-position` | `auto`, `right`, `bottom` | `auto` |
| `marks` | `true`, `false` | `false` |
| `labels` | `full`, `short` | `full` |
| `levels` | `true`, `false` | `true` |
| `initials` | `true`, `false`: abbreviate contributor labels | `false` in MyST/Typst; `true` in CLI/Sphinx/Quarto/Pandoc |
| `horizontal` | `true`, `false`: contributors in rows | `false` |
| `skipempty` | `true`, `false`: omit roles nobody holds | `true` |

The app and the JavaScript `buildHeatmapSvg` function also take `colorBy`: `"color"` (the
default) draws the figure in one hue, and `"contributor"` gives each of up to eight contributors
their own hue, with the level key in neutral gray. Past eight contributors it falls back to one
hue. The plugins and the CLI draw one hue only.

`color` overrides the palette. The palettes use blue `#1f4e79`, green `#00724c`, or gray `#404040`.
Supporting, Equal and Lead mix 40%, 70% and 100% of that hue with white. These are contribution
levels, not continuous measurements of effort.

Pick a dark custom `color`. Nothing rejects a pale one, but the Supporting level (40% of the hue)
must stand out from an empty cell (`#ececea`). Measured contrast of that level against the empty
fill: `#f0e442` 1.05:1, `#e69f00` 1.16:1, `#56b4e9` 1.17:1, `#cc79a7` 1.28:1, `#009e73` 1.37:1,
`#d55e00` 1.41:1. Use `#0072b2` (1.53:1) or darker; the shipped palettes measure 1.58:1 to 1.77:1.

Short labels pair the canonical role number with the first twelve characters of its translated
name. The text alternative retains the full names.

SVG sizes must be greater than zero and at most 256 pixels. Typst sizes must be greater than zero
and at most 192 points. Scaling the whole SVG remains available through the JavaScript `scale` option.
The JavaScript `monoColor`, `transpose` and `showLevels` options are deprecated aliases of `color`,
`horizontal` and `levels`, and still work. `acronyms` is unchanged.
Automatic placement puts a vertical key to the right when three things hold: the grid is at least
1.5 times as tall as it is wide, the figure grows by no more than 35% in width (and stays within 48
legend-font ems), and its height does not increase. That width limit keeps legend text above 5 pt
at 85 mm. Otherwise the key wraps below. Force `right` or `bottom` to suit the surrounding page;
`legend: false` hides the key regardless of placement. In the app these choices share one Legend control.

Font size changes the label bands and legend layout without changing contribution data.
App, CLI and plugin exports embed bundled Noto Sans or Noto Serif fonts. See the
[figure font guide](figures/README.md) for coverage, offline use and desktop-editor limits.
Typst can fall back to a monospace sans font when proportional sans fonts are unavailable.
Typst also retains `cell` and `gap` for existing documents; `size` overrides `cell`.

## CLI

```sh
credit-matrix convert contributors.json --to svg --palette green --shape square --size 22 --font sans --font-size 10.5 --legend true --legend-position auto --marks false --labels full --horizontal --skipempty true --initials false > heatmap.svg
```

The CLI uses `--yes-no` to turn levels off, and `--horizontal` as a flag. Boolean options with values
(`--legend`, `--marks`, `--skipempty` and `--initials`) require the word `true` or `false`.

## MyST and Jupyter Book

Add this directive beside `{credit-statement}`. It reads the same author roles:

```markdown
:::{credit-heatmap}
:palette: green
:shape: square
:size: 22
:font: sans
:font-size: 10.5
:initials: false
:legend: true
:labels: full
:horizontal: false
:skipempty: true
:::
```

The plugin writes content-addressed SVG assets into `_credit_matrix/` beside the source page.
MyST includes the asset in its normal image pipeline. These generated files can be ignored by Git.
MyST's author roles have no contribution degrees, so its figures default to `levels: false` and show contributed or empty cells.

## Sphinx

```rst
.. credit-heatmap:: contributors.json
   :palette: green
   :shape: square
   :size: 22
   :font: sans
   :font-size: 10.5
   :initials: false
   :legend: true
   :levels: true
   :labels: full
   :skipempty: true
```

Use `:horizontal:` without a value to transpose. `:locale:` follows the statement directive.
The extension writes SVG assets into `_credit_matrix/` under the source root and tracks the input
file as a dependency. Sphinx copies the generated image into its output.

## Quarto and Pandoc

Statement-only documents need no Node installation. To add a figure, install the package CLI and
set `heatmap: true` under `credit-matrix` in the manuscript's front matter:

```yaml
credit-matrix:
  heatmap: true
  palette: green
  shape: square
  size: 22
  font: sans
  font-size: 10.5
  initials: false
  legend: true
  labels: full
  levels: true
  horizontal: false
  skipempty: true
```

The filter invokes `credit-matrix` from `PATH`. To select a local installation, set the
`CREDIT_MATRIX_COMMAND` environment variable to a command line, for example
`CREDIT_MATRIX_COMMAND="node node_modules/credit-matrix/dist/cli.js" quarto render`. The filter splits
it at whitespace, so no part of it can contain a space, and no shell runs. A document cannot choose
the program: the filter does not read it from metadata.

The filter puts the SVG into Pandoc's media bag. For standalone HTML, use `--embed-resources`, or
extract the image with `--extract-media=images`. Quarto handles the image through its normal media
pipeline. SVG support in PDF and Word depends on the output engine and its image converters.

## Typst

```typ
#credit-heatmap(team, palette: "green", shape: "square", size: 16pt,
  font: "sans", font-size: 7.5pt, initials: false,
  legend: true, labels: "full", horizontal: false, skipempty: true,
  caption: [Contribution heatmap.])
```

Figures use the document language unless `lang` overrides it. `caption` and other figure arguments
pass through to Typst's `figure` function.

## App and document exports

Palette, color, shape, cell size, typography, legend, role labels, orientation and empty-role filtering
apply to SVG figures in the app, CLI and document plugins. Typst draws equivalent native figures.
The app adds preview zoom, saved settings per draft, reset and PNG resolution controls. Colour,
orientation and initials are shared with the grid's Heatmap options; Figure settings' Reset covers the rest.
Under Figure settings, open Export recipe to copy a CLI command or a Sphinx, Quarto/Pandoc,
MyST/Jupyter Book or Typst snippet. Recipes contain the current style settings and fixed data
placeholders, without contributor names or PNG settings. Supply the contributor data and install
the CLI or plugin first. MyST uses its page author roles and language, with yes/no contributions.
Set `lang` in the page front matter or `project.lang` in `myst.yml` to match the app’s language.
Typst recipes convert CSS pixels to points; native layout and font metrics can differ from SVG.
PNG width (40–300 mm) and resolution (150, 300 or 600 dpi) set its pixel dimensions and print metadata.
SVG keeps its intrinsic vector dimensions; typography and cell spacing determine its layout.
PNG download and image clipboard copy require a browser; the CLI and document plugins produce vector figures.
Use `initials` to switch contributor labels between initials and full names in the CLI and plugins.
The JavaScript API calls this option `acronyms`. Text alternatives always retain full names.
MyST and Typst fall back to full names when initials would identify more than one contributor.
Typst preserves unspaced names and otherwise takes the first grapheme of each word.
Its name parsing can differ from JavaScript. Set each contributor's `initials` explicitly to align Typst labels with the app.

## Final-size readability checks

The browser test suite includes `e2e/heatmap-print.spec.ts`. It renders small teams and long
contributor names in all nine output languages, using both font stacks. Reference figures fit
within 89 mm or 183 mm columns and a 170 mm height; the test reduces width when height requires it.
These are reference bounds from the [Nature figure guide](https://research-figure-guide.nature.com/figures/building-and-exporting-figure-panels/), not universal journal requirements.

Reference fixtures exercise both plain default fills and optional marks. Tests require at least 5 pt
for the smallest text, including the legend. They measure actual browser text bounds for clipping and overlap, check 4.5:1 text contrast and 3:1 contribution-mark contrast,
and save SVG, rendered PNG and physical-size measurements under `test-results/`.
The existing CI Playwright job runs them on Chromium for PRs and all three engines on main and weekly.

Run locally with `pnpm exec playwright test e2e/heatmap-print.spec.ts`. A dense-team regression
also confirms that a valid figure can be too small at column width, or too tall after transposition.
The app's small-print advisory uses the actual smallest exported text rather than the selected
nominal font size, at the width you chose.
The CLI and the document plugins warn as well: on stderr for the CLI, Quarto and Pandoc, and as a
build warning in MyST and Sphinx. They measure the figure scaled to fit 183 × 170 mm, and warn
below 6 pt. That happens from about 25 contributors, in either orientation. A larger team's
figure needs a page of its own, such as a supplementary figure. Typst has no build warnings, so the
Typst package does not warn. To keep a strict build passing once you have checked the figure, add
`suppress_warnings = ["credit_matrix"]` to Sphinx's `conf.py`, or this to MyST's `myst.yml`:

```yaml
project:
  error_rules:
    - rule: credit-heatmap-small-print
      severity: ignore
``` Increasing PNG DPI does not increase the printed text size.

These checks cover the reference fixtures and installed browser fonts. They do not replace checking
the final manuscript, a native reader's review, a physical printed proof, or the publisher's font rules.
