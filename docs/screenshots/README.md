# Screenshots

The README uses these three images. They are taken at 1440 × 900 in light mode.

- `hero.png`: the sample data loaded, with the Team tab open.
- `empty-state.png`: the first-run welcome over the empty workspace.
- `statement-export.png`: the Statement tab with the *Export data* menu open.

To retake them after a UI change:

```bash
pnpm build
cd out && python3 -m http.server 4461 --bind 127.0.0.1 &
node scripts/screenshots.mjs        # or pass another URL as the first argument
kill %1
```

The script needs Playwright's Chromium (`pnpm exec playwright install chromium`). It overwrites the
three files in this folder. Update the alt text in the README if what they show has changed.
