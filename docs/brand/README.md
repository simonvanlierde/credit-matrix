# Brand assets

The rules for the mark and the lockup are in [DESIGN.md](../../DESIGN.md#brand). Each column of the
mark is one contributor, in the first three `CONTRIBUTOR_HUES`, and its cell fills are the app's
real heatmap levels from `heatCellColor` in `src/core/contributor-color.ts` (the light ramp, and in
the favicon also the dark one), plus the fill of an empty cell.

| Asset | Source | Output |
| --- | --- | --- |
| Favicon | `public/icon.svg` | Served as written; has its own dark-mode fills |
| Header lockup | `src/components/BrandMark.tsx` | Rendered inline; draws in `currentColor`, so it follows the theme |
| Apple touch icon | `docs/brand/apple-icon.html` | `public/apple-icon.png` |
| Social card | `docs/brand/opengraph-image.html` | `public/opengraph-image.png` |
| Maskable icon | `docs/brand/maskable-icon.html` | `public/icon-512.png`, via the web app manifest |

The PNGs are rendered from the HTML in this folder ahead of time, not on each request, because
rendering them in the Cloudflare Worker would need a WASM image renderer.

```sh
pnpm exec playwright screenshot --viewport-size=1200,630 \
  "file://$PWD/docs/brand/opengraph-image.html" public/opengraph-image.png
pnpm exec playwright screenshot --viewport-size=180,180 \
  "file://$PWD/docs/brand/apple-icon.html" public/apple-icon.png
pnpm exec playwright screenshot --viewport-size=512,512 \
  "file://$PWD/docs/brand/maskable-icon.html" public/icon-512.png
```

The social card shows the sample data that "Load sample data" loads, so its statement is one the
app really produces.

The social card is a poster for link previews, which show it 300 to 500 px wide and sometimes crop it
to a square. Keep everything that carries meaning in the centred 630 px and large enough to read at a
quarter size, and after a change look at it at 300 px wide and as a centre square crop.
