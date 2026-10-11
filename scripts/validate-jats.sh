#!/usr/bin/env bash
# Validate the JATS fixture and a fresh export against the vendored JATS 1.3 DTD.
set -euo pipefail
cd "$(dirname "$0")/.."

fresh=$(mktemp --suffix=.xml)
trap 'rm -f "$fresh"' EXIT

JATS_OUT=$fresh pnpm exec vitest run src/core/__tests__/jats-sample-export.test.ts >/dev/null

# The catalog maps the DOCTYPE's public identifier to the vendored DTD, so this
# also fails when an export names the wrong DTD; --nonet keeps it off the network.
XML_CATALOG_FILES=test/jats-dtd/catalog-jats-v1-3-no-base.xml \
	"${XMLLINT:-xmllint}" --nonet --noout --valid src/core/__tests__/fixtures/export-jats.xml "$fresh"
echo "JATS validation passed"
