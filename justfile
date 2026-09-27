# CRediT Generator: development commands
# Requires: just (https://github.com/casey/just), pnpm ≥ 11, Node ≥ 26
# Most tasks are pnpm scripts (see package.json); these recipes add value on top.

# List available recipes
default:
    @just --list

# Run tests in watch mode (packages/core only)
test-watch:
    pnpm --filter @credit-generator/core exec vitest

# Release: bump package.json, sync CITATION.cff, commit, and tag
# (write the dated CHANGELOG entry first)
release version:
    pnpm version {{version}} -m 'chore(release): v%s'
