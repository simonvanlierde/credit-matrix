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

# Only release-owned fields go into the source; names, roles and other metadata stay intact.
mkdir -p .cache
release_metadata_dir=$(mktemp -d .cache/release-metadata.XXXXXX)
trap 'rm -rf "$release_metadata_dir"' EXIT
printf 'cff-version: 1.2.0\nversion: "%s"\ndate-released: "%s"\n' "$v" "$released" >"$release_metadata_dir/CITATION.cff"
uvx --from citesync==0.2.0 citesync write --root . --source "$release_metadata_dir/CITATION.cff"
V=$v perl -pi -e 's/^version: .*/version: $ENV{V}/' integrations/quarto/_extensions/credit-matrix/_extension.yml
git add CITATION.cff codemeta.json src/core/package.json integrations/quarto/_extensions/credit-matrix/_extension.yml
