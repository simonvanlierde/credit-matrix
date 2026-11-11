# Screenshots

The README shows `hero.png`: the sample data loaded, with the Team tab open. It is taken at
1440 × 900 in light mode, with the getting-started checklist dismissed.

To retake it after a UI change:

```bash
pnpm build
cd out && python3 -m http.server 4461 --bind 127.0.0.1 &
node scripts/screenshots.mjs        # or pass another URL as the first argument
kill %1
```

The script needs Playwright's Chromium (`pnpm exec playwright install chromium`). It overwrites
`hero.png`. Update the alt text in the README if what it shows has changed.
