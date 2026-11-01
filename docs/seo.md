# Search engines

What the site tells search engines, where each piece lives, and what to check when you change a
page.

## What the build sets

- **Titles and descriptions.** Each page exports `metadata` from its `page.tsx`. The home page's
  title and description are in [`src/app/layout.tsx`](../src/app/layout.tsx), and the other pages
  inherit the social card from there.
- **Canonical address.** Each page sets `alternates.canonical` to its own path. The layout sets
  none, so a new page without one has no canonical link rather than a wrong one.
- **Sitemap.** [`src/app/sitemap.ts`](../src/app/sitemap.ts) lists every page to index, and
  [`public/robots.txt`](../public/robots.txt) points to it.
- **Structured data (JSON-LD).** The home page describes the app as a `WebApplication`, built from
  [`codemeta.json`](../codemeta.json) so its licence, version and authors match the release
  metadata that citesync keeps in step with `CITATION.cff`. The census page describes its counts as
  a `Dataset`.

## When you add or change a page

1. Add its path to `sitemap.ts` and give it a canonical path.
2. Give every JSON-LD block a `license`. Search Console reports a missing licence as an issue on
   `Dataset` and software items, and it is easy to forget.
3. Take facts in JSON-LD from a file the release already maintains (`codemeta.json`,
   `census.json`), not from copies typed into the page.
4. After the deploy, run the page through the
   [Rich Results test](https://search.google.com/test/rich-results) and fix what it reports.

## Search Console

A Domain property for `duinlab.nl` (verified by DNS) covers every subdomain, so it covers this
site. A URL-prefix property for `https://duinlab.nl/` does not: that needs its own
`https://credit.duinlab.nl/` property. Submit `https://credit.duinlab.nl/sitemap.xml` under
Sitemaps.
