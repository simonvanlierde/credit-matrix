# Brand assets

The mark is a 3×3 crop of the contribution matrix, lead on the diagonal. Cell fills are the app's
real intensity tiers from `src/core/contributor-color.ts`: white mixed 0.4, 0.7, and 1.0
toward ink-blue, plus the empty-cell fill.

| Asset | Source | Output |
| --- | --- | --- |
| Favicon | `src/app/icon.svg` | Served as written; carries its own dark-mode fills |
| Header lockup | `src/components/BrandMark.tsx` | Rendered inline; draws in `currentColor`, so it follows the theme |
| Apple touch icon | `docs/brand/apple-icon.html` | `src/app/apple-icon.png` |
| Social card | `docs/brand/opengraph-image.html` | `src/app/opengraph-image.png` |
| Maskable icon | `docs/brand/maskable-icon.html` | `public/icon-512.png`, via the web app manifest |

The two PNGs are rendered from the HTML in this folder, not generated at request time: `next/og`
needs a WASM renderer that the Cloudflare Workers runtime does not carry for free.

```sh
pnpm exec playwright screenshot --viewport-size=1200,630 \
  "file://$PWD/docs/brand/opengraph-image.html" src/app/opengraph-image.png
pnpm exec playwright screenshot --viewport-size=180,180 \
  "file://$PWD/docs/brand/apple-icon.html" src/app/apple-icon.png
pnpm exec playwright screenshot --viewport-size=512,512 \
  "file://$PWD/docs/brand/maskable-icon.html" public/icon-512.png
```

The social card shows the same sample dataset the app's "Load sample data" action loads, so the
statement on it is output the app really produces.
