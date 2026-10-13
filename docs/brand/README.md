# Brand assets

The rules for the mark and the lockup are in [DESIGN.md](../../DESIGN.md#brand). The mark's cell
fills are the app's real heatmap levels from `src/core/contributor-color.ts`: white mixed 0.4, 0.7,
and 1.0 of the way toward ink-blue, plus the fill of an empty cell.

| Asset | Source | Output |
| --- | --- | --- |
| Favicon | `src/app/icon.svg` | Served as written; carries its own dark-mode fills |
| Header lockup | `src/components/BrandMark.tsx` | Rendered inline; draws in `currentColor`, so it follows the theme |
| Apple touch icon | `docs/brand/apple-icon.html` | `src/app/apple-icon.png` |
| Social card | `docs/brand/opengraph-image.html` | `src/app/opengraph-image.png` |
| Maskable icon | `docs/brand/maskable-icon.html` | `public/icon-512.png`, via the web app manifest |

The two PNGs are rendered from the HTML in this folder ahead of time, not on each request, because
`next/og` needs a WASM renderer that the Cloudflare Workers runtime doesn't include for free.

```sh
pnpm exec playwright screenshot --viewport-size=1200,630 \
  "file://$PWD/docs/brand/opengraph-image.html" src/app/opengraph-image.png
pnpm exec playwright screenshot --viewport-size=180,180 \
  "file://$PWD/docs/brand/apple-icon.html" src/app/apple-icon.png
pnpm exec playwright screenshot --viewport-size=512,512 \
  "file://$PWD/docs/brand/maskable-icon.html" public/icon-512.png
```

The social card shows the sample data that "Load sample data" loads, so its statement is one the
app really produces.
