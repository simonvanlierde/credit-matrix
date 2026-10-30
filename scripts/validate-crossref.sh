#!/usr/bin/env bash
# Validate a fresh Crossref export against the Crossref metadata schema 5.5.0.
# The export is a <contributors> block, so it goes into a minimal journal
# article deposit first. The schema is XSD 1.1 (it checks each role's type
# against its vocab with assertions), which xmllint cannot read, so the check
# runs with the xmlschema Python package through uvx.
# The schema release downloads on first run, is checked against a pinned hash,
# and is cached in .cache/.
set -euo pipefail
cd "$(dirname "$0")/.."

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fresh=$tmp/contributors.xml
deposit=$tmp/deposit.xml

CROSSREF_OUT=$fresh pnpm exec vitest run src/core/__tests__/crossref.test.ts >/dev/null

cache=.cache/crossref
schemas=$cache/schema-0.6.0-schemas/schemas
if [[ ! -f $schemas/crossref5.5.0.xsd ]]; then
	mkdir -p "$cache"
	# Release 0.6.0 is the one that brought schema 5.5.0.
	curl -fsSL --retry 3 -o "$cache/schemas.tar.gz" \
		"https://gitlab.com/crossref/schema/-/archive/0.6.0/schema-0.6.0.tar.gz?path=schemas"
	hash=592ed1349d3f9bb92c3820e6d13003769f27eadf1b2bf4c0a8bcd8ee523df407
	if command -v sha256sum >/dev/null; then
		echo "$hash  $cache/schemas.tar.gz" | sha256sum -c --quiet -
	else
		echo "$hash  $cache/schemas.tar.gz" | shasum -a 256 -c --quiet -
	fi
	tar -xzf "$cache/schemas.tar.gz" -C "$cache"
fi

cat >"$deposit" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<doi_batch xmlns="http://www.crossref.org/schema/5.5.0" version="5.5.0">
  <head>
    <doi_batch_id>credit-matrix-check</doi_batch_id>
    <timestamp>20261030000000</timestamp>
    <depositor>
      <depositor_name>CRediT Matrix</depositor_name>
      <email_address>check@example.org</email_address>
    </depositor>
    <registrant>CRediT Matrix</registrant>
  </head>
  <body>
    <journal>
      <journal_metadata>
        <full_title>Journal of Examples</full_title>
      </journal_metadata>
      <journal_article>
        <titles><title>An example article</title></titles>
$(cat "$fresh")
        <publication_date><year>2026</year></publication_date>
        <doi_data>
          <doi>10.5555/example</doi>
          <resource>https://example.org/article</resource>
        </doi_data>
      </journal_article>
    </journal>
  </body>
</doi_batch>
EOF

uvx --from xmlschema==4.3.2 xmlschema-validate -v --version 1.1 --schema "$schemas/crossref5.5.0.xsd" "$deposit"
echo "Crossref schema 5.5.0: passed"
