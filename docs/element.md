# The `<credit-matrix>` element

`<credit-matrix>` shows a CRediT statement and the contribution heatmap on any web page, from a JSON
file exported by [CRediT Matrix](https://credit.duinlab.nl) (**Export data**, **JSON**). It needs no
framework and no build step.

## Copy and paste

```html
<script type="module" src="https://esm.sh/credit-matrix@0.7.0/element"></script>

<credit-matrix src="contributions.json"></credit-matrix>
```

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

## Attributes

| Attribute | Value                                                                 |
| --------- | --------------------------------------------------------------------- |
| `src`     | URL of the JSON file. Without it, the element reads its JSON child.   |
| `format`  | `by-role` (default), `by-role-short`, `by-author` or `by-author-short` |

Changing either attribute renders again.

## What it renders

Inside a shadow root, so the page's styles neither leak in nor out:

- the heatmap, as an `<svg role="img">` named "Contribution heatmap" for screen readers;
- the statement as plain text, one paragraph per line (the `CRediT:` line, then any
  acknowledgements and notes).

It uses IBM Plex Sans when the page has loaded it, and otherwise Helvetica or Arial. If the JSON does
not load or is not a CRediT Matrix export, the element says so in an alert.

The statement and the heatmap are in English. For another language, generate the statement with the
package or the CLI (`credit-matrix statement file.json --locale fr`).
