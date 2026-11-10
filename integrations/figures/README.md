# Keep figure fonts with the figure

Use the PDF download for a publication figure whose text must look the same on
another computer. It embeds the glyphs it uses and retains selectable text and
vector cells. SVG embeds fonts too, but desktop applications and document
converters vary in their support for SVG web fonts.

Neither format turns text into outlines or a raster image. An editor may still
require the original fonts to change labels or add characters. Embedded PDF
subsets contain the existing glyphs, not an installed font for further editing.

## Choose an export

| Surface | Embedded fonts | Text and limitations |
| --- | --- | --- |
| App SVG download | Yes | SVG text remains editable; the receiving tool must support embedded web fonts. |
| App PDF download | Yes | Selectable text and vector shapes; editing support depends on the editor. |
| App PNG download | Rendered into pixels | Fixed appearance; text is no longer editable or selectable. |
| CLI `--to svg` or `--to pdf` | Yes | Same figure renderer as the app. |
| MyST / Jupyter Book heatmap | Yes, in SVG | The document engine's image pipeline determines final rendering. |
| Sphinx heatmap | Yes, in SVG | Conversion to a different image format can change font handling. |
| Quarto / Pandoc heatmap | Yes, in SVG | HTML preserves the SVG asset; PDF and Word converters vary. |
| Native Typst heatmap | Uses Typst's fonts | Independent native renderer; fonts follow the document configuration. |
| JavaScript `buildHeatmapSvg` | No | Lightweight renderer with system font references. |

The standalone JavaScript API is `createFigureRenderer` from
`credit-matrix/figures`. Create it once, then call `await svg(authors, options)` or
`await pdf(authors, options)`. It uses the same options as `buildHeatmapSvg`. It loads
each font face the first time a figure's text needs it and keeps it for later figures.

```sh
credit-matrix convert team.json --to svg > heatmap.svg
credit-matrix convert team.json --to pdf > heatmap.pdf
```

The document directives generate SVG assets. They do not select PDF automatically
for PDF or Word manuscripts. If your converter ignores the embedded SVG fonts,
export the PDF separately and include it through the document engine's image
support.

## Fonts and offline use

Portable exports use regular Noto Sans and Noto Serif, plus Credit Figure JP, SC, Serif JP and Serif SC,
derived from the corresponding Noto Japanese and Simplified Chinese families. The fonts cover all nine output languages.
Contributor names can contain characters outside
these fonts; portable export reports unsupported characters instead of silently
substituting installed fonts. Arabic, Hebrew and Devanagari are outside this set.
Han characters use the Simplified Chinese face, unless the output language is Japanese or
the label contains kana. In Chinese output, punctuation beside Han text comes from the Chinese face.

The font files ship with the package, and the CLI and JavaScript API read them from disk.
The app fetches a face from its own site the first time an export needs it; its offline
cache keeps that face, so later exports also work offline. A face never used online is
not available offline. See
[font sources, checksums and licenses](../../src/core/figure-fonts/README.md).
SVG and PDF include only the glyphs used in the figure: a Japanese or Chinese figure
is about 35 kB in either format. The SVG subsets have no OpenType layout tables, so an
uncomposed combining accent can sit less precisely in SVG than in PDF.
The fonts use the SIL Open Font License 1.1; embedding does not change the
figure's license.

## Receiving applications

Modern browsers support SVG fonts included through `@font-face` data URLs.
External font URLs cannot load in some SVG image contexts, so these exports
include the font bytes in the asset. See
[SVG image restrictions](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image).

Inkscape 1.2.2 and 1.4 ignore the SVG's embedded `@font-face` fonts. Install the
bundled fonts before importing SVG for editing; this preserves Unicode labels.
PDF remains portable for viewing or placing in a document. Inkscape's PDF import
can turn text into outlines when its fonts are unavailable. Even with the fonts
installed, PDF import changed the uncomposed accent in `q́`; SVG import preserved it.
Use SVG with installed fonts when editing labels.

Illustrator, Office and journal converters have not been tested. Check imported
labels before submission.

Native Typst figures use the document's font selection and Typst's fallback.
To choose these fonts, supply them to Typst and set a matching font stack, for
example `#set text(font: ("Noto Sans", "Credit Figure JP", "Credit Figure SC"))`.
Typst's PDF and SVG exports have different text behavior: its SVG output
[converts glyphs to shapes](https://typst.app/docs/reference/svg/).

Keep the figure at its intended print size when checking readability. Embedded
fonts do not enforce a journal's typeface, dimensions, minimum text size or
submission rules; check the target publication's requirements.
