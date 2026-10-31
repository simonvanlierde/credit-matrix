#!/usr/bin/env bash
# Keep citation metadata, the published package and Quarto extension in step with package.json.
# The version lifecycle runs this after a version bump and before the release commit.
set -euo pipefail

v=${npm_package_version:?run via 'pnpm version', not directly}
released=$(sed -n -E "s/^## \[${v//./\\.}\] - ([0-9]{4}-[0-9]{2}-[0-9]{2})$/\1/p" CHANGELOG.md | head -1)
[[ -n $released ]] || {
  echo "No dated CHANGELOG entry for $v" >&2
  exit 1
}

V=$v D=$released perl -pi -e 's/^(version: ").*"/$1$ENV{V}"/; s/^(date-released: ").*"/$1$ENV{D}"/' CITATION.cff
V=$v D=$released perl -pi -e 's/^(  "version": ").*"/$1$ENV{V}"/; s/^(  "datePublished": ").*"/$1$ENV{D}"/' codemeta.json
V=$v perl -pi -e 's/^(  "version": ").*"/$1$ENV{V}"/' src/core/package.json
V=$v perl -pi -e 's/^version: .*/version: $ENV{V}/' integrations/quarto/_extensions/credit-matrix/_extension.yml
git add CITATION.cff codemeta.json src/core/package.json integrations/quarto/_extensions/credit-matrix/_extension.yml
