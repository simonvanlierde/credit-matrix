## What

<!-- What changes, and why. -->

## How I verified it

<!-- Commands run (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`) and anything checked by hand. -->

## Checklist

- [ ] Tests added or updated for any change to domain logic (`src/core`)
- [ ] Translation: new or changed UI strings are in every `src/messages/*.json` (`pnpm exec playwright test e2e/messages.spec.ts` passes), or this PR touches no strings
- [ ] `CHANGELOG.md` updated under `[Unreleased]` for user-visible changes
