# Contribution heatmap figures

The app's SVG and PNG downloads, the CLI, and the document plugins draw square cells with a thin
neutral rule. Rotated headers keep names beside their columns. White paper, one hue, and three
increasing intensities distinguish Supporting, Equal and Lead. Empty cells stay light gray.
This follows the compact matrix layout of [latex-credits](https://ctan.org/pkg/latex-credits).

The SVG renderer is shared by the app, CLI, MyST, Sphinx and Quarto/Pandoc. Typst draws native
vector shapes with the same palettes and level fractions. Figures carry the full contribution
statement as their text alternative, including levels even when axis labels are shortened.
The shared SVG renderer also marks Supporting, Equal and Lead with one, two and three dots in both
cells and legend. Yes/no figures use a check for an assigned role. The app previews the exported
figure before copying or downloading, with fit-to-width and actual-size views and the PNG pixel dimensions.

## Figure options

Use these names in every plugin. The JavaScript `buildHeatmapSvg` function accepts the same keys.

| Option | Values | Default |
| --- | --- | --- |
| `color` | Three- or six-digit hex color; Typst takes a color value | Palette's base hue |
| `palette` | `blue`, `green`, `gray` | `blue` |
| `shape` | `square`, `rounded`, `circle` | `square` |
| `size` | Cell side: pixels in SVG, a length in Typst | `22`, or `14pt` in Typst |
| `legend` | `true`, `false` | `true` |
| `labels` | `full`, `short` | `full` |
| `levels` | `true`, `false` | `true` |
| `horizontal` | `true`, `false`: contributors in rows | `false` |
| `skipempty` | `true`, `false`: omit roles nobody holds | `true` |

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
Typst also retains `cell` and `gap` for existing documents; `size` overrides `cell`.

## CLI

```sh
credit-matrix convert contributors.json --to svg --palette green --shape square --size 22 --legend true --labels full --horizontal --skipempty true > heatmap.svg
```

The CLI uses `--yes-no` to turn levels off, and `--horizontal` as a flag. Boolean options with values
(`--legend` and `--skipempty`) require the word `true` or `false`.

## MyST and Jupyter Book

Add this directive beside `{credit-statement}`. It reads the same author roles:

```markdown
:::{credit-heatmap}
:palette: green
:shape: square
:size: 22
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
  legend: true
  labels: full
  levels: true
  horizontal: false
  skipempty: true
```

The filter invokes `credit-matrix` from `PATH`. To select a local installation, set `command` to
an argument list, for example `[node, node_modules/credit-matrix/dist/cli.js]`. No shell runs.
Rendering someone else's document with the filter runs the command it names: read its metadata first.

The filter puts the SVG into Pandoc's media bag. For standalone HTML, use `--embed-resources`, or
extract the image with `--extract-media=images`. Quarto handles the image through its normal media
pipeline. SVG support in PDF and Word depends on the output engine and its image converters.

## Typst

```typ
#credit-heatmap(team, palette: "green", shape: "square", size: 16pt,
  legend: true, labels: "full", horizontal: false, skipempty: true,
  caption: [Contribution heatmap.])
```

Figures use the document language unless `lang` overrides it. `caption` and other figure arguments
pass through to Typst's `figure` function.
