#!/usr/bin/env bash
# Validate the JATS fixture and a fresh export against the vendored JATS 1.3 DTD.
set -euo pipefail
cd "$(dirname "$0")/.."

dtd=test/jats-dtd/JATS-archivearticle1-3-mathml3.dtd
fresh=$(mktemp --suffix=.xml)
trap 'rm -f "$fresh"' EXIT

JATS_OUT=$fresh pnpm exec vitest run src/core/__tests__/jats-sample-export.test.ts >/dev/null

"${XMLLINT:-xmllint}" --noout --dtdvalid "$dtd" src/core/__tests__/fixtures/export-jats.xml "$fresh"
echo "JATS validation passed"
