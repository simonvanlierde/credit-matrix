# The `<credit-matrix>` element

`<credit-matrix>` shows a CRediT statement and the contribution heatmap on any web page, from a JSON
file exported by [CRediT Matrix](https://credit.duinlab.nl) (**Export data**, **JSON**). It needs no
framework and no build step.

## Copy and paste

```html
<script type="module" src="https://esm.sh/credit-matrix/element"></script>

<credit-matrix src="contributions.json"></credit-matrix>
```

This loads the latest release. To keep a page from changing under you, pin the version you tested
with, for example `https://esm.sh/credit-matrix@0.8.1/element` (use the version you installed).

Or put the JSON in the page:

```html
<credit-matrix format="by-author">
  <script type="application/json">
    {"version":1,"authors":[ ... ]}
  </script>
</credit-matrix>
```

With a bundler, import it once instead of the script tag:

```js
import "credit-matrix/element";
```

Without a bundler, load it through esm.sh as above. The package's `element.js` imports `zod/mini` by
its bare name, which a browser cannot find on its own: to serve the file yourself, add an
[import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/script/type/importmap)
that points `zod/mini` at a copy of zod.

## Attributes

| Attribute | Value                                                                                                 |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `src`     | URL of the JSON file. Without it, the element reads its JSON child.                                   |
| `format`  | `by-role` (default), `by-role-short`, `by-author` or `by-author-short`. Any other value is `by-role`. |
| `locale`  | Language of the statement and heatmap, such as `fr` or `zh-Hans`. See below.                          |

Changing any attribute renders again. A `format` or `locale` change reuses the file already
downloaded; setting `src`, even to the same URL, downloads it again, as does calling `render()`.
Without `src`, adding or editing the JSON child also renders again, so a script can fill it in after
the element is on the page.

## Language

The element writes role names, level names and the heatmap in one of the languages CRediT Matrix
offers: `en`, `fr`, `de`, `es`, `it`, `pt-PT`, `nl`, `zh-Hans` and `ja`. It takes the `locale`
attribute, or else the `lang` of the nearest element around it, such as `<html lang="fr">`. A
regional tag such as `de-DE` uses its language, `de`. Any language it does not offer is English. The
`CRediT:` prefix stays English in every language.

## What it renders

Inside a shadow root, so the page's styles neither leak in nor out, on its own light card:

- the heatmap, drawn at its full size. On a narrow page it scrolls sideways instead of shrinking
  its labels;
- a table of each contributor's level in each role, for screen readers (see the
  [accessibility statement](accessibility.md#the-web-element));
- the statement as plain text, one paragraph per line (the `CRediT:` line, then any
  acknowledgements and notes).

It uses IBM Plex Sans when the page has loaded it, and otherwise Helvetica or Arial. While it fetches
`src` it shows "Loading contributions…". If the file cannot be fetched (a network error, an HTTP
error or a file over 1 MB), or it is not a CRediT Matrix export, the element says which in an alert.
These messages are in English.

## Avoid a jump while it loads

Until the script has loaded, the browser shows `<credit-matrix>` as an empty inline element, and the
page shifts when the content appears. Reserve some room in the page's own CSS:

```css
credit-matrix:not(:defined) {
  display: block;
  min-height: 20rem;
}
```

Set the height to roughly what your figure needs.
