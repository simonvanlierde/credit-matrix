#!/usr/bin/env bash
# Keeps CITATION.cff and codemeta.json in step with package.json. Run by the `version` npm
# lifecycle script, which fires after `pnpm version` bumps package.json and
# before it commits, so the `git add` here lands in the release commit.
set -euo pipefail

v=${npm_package_version:?run via 'pnpm version', not directly}
released=$(sed -n -E "s/^## \[${v//./\\.}\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})$/\1/p" CHANGELOG.md | head -1)
[[ -n $released ]] || { echo "No dated CHANGELOG entry for $v" >&2; exit 1; }

V=$v D=$released perl -pi -e 's/^(version: ").*"/$1$ENV{V}"/; s/^(date-released: ").*"/$1$ENV{D}"/' CITATION.cff
V=$v D=$released perl -pi -e 's/^(  "version": ").*"/$1$ENV{V}"/; s/^(  "datePublished": ").*"/$1$ENV{D}"/' codemeta.json
git add CITATION.cff codemeta.json
