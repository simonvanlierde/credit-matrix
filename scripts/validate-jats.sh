#!/usr/bin/env bash
# Validate the JATS fixture, the conformance suite and a fresh export twice:
#   1. against the vendored JATS 1.3 DTD, with xmllint;
#   2. against the JATS4R Schematron rules (MIT, github.com/jats4r/jats-schematrons),
#      compiled to XSLT with SchXslt2 (MIT) and run with SaxonJS (the xslt3 dev
#      dependency), because the rules need XPath 2.0, which xmllint lacks.
# SaxonJS is free to run but not open source (Saxonica's licence allows use, not
# unmodified redistribution outside an app). Keep xslt3 a dev dependency: it must
# never ship in the site or in a published package.
# The rules and SchXslt2 download on first run, are checked against pinned
# hashes, and are cached in .cache/.
set -euo pipefail
cd "$(dirname "$0")/.."

# A temporary directory, not mktemp --suffix, which only GNU mktemp has.
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
fresh=$tmp/export.xml

JATS_OUT=$fresh pnpm exec vitest run src/core/__tests__/jats-sample-export.test.ts >/dev/null
files=(src/core/__tests__/fixtures/export-jats.xml conformance/cases/*.xml "$fresh")

# 1. DTD. The catalog maps the DOCTYPE's public identifier to the vendored DTD, so
# this also fails when an export names the wrong DTD; --nonet keeps it off the network.
XML_CATALOG_FILES=test/jats-dtd/catalog-jats-v1-3-no-base.xml \
	"${XMLLINT:-xmllint}" --nonet --noout --valid "${files[@]}"
echo "JATS 1.3 DTD: passed"

# 2. JATS4R rules
# fetch <url> <sha256> <dest>
fetch() {
	curl -fsSL --retry 3 -o "$3" "$1"
	if command -v sha256sum >/dev/null; then
		echo "$2  $3" | sha256sum -c --quiet -
	else
		echo "$2  $3" | shasum -a 256 -c --quiet -
	fi
}

j4r=.cache/jats4r
rules=$j4r/jats-schematrons-0.0.17/schematrons/1.0
# The rules load credit-roles.xml with document(), relative to the compiled
# stylesheet, so it has to sit next to them.
compiled=$rules/jats4r.compiled.xsl
if [[ ! -f $compiled ]]; then
	mkdir -p "$j4r"
	fetch https://github.com/jats4r/jats-schematrons/archive/refs/tags/v0.0.17.tar.gz \
		97cc464bb1e816745eda7c3fc279f6024c72094491599df2d51a6a3cfd204b9a "$j4r/rules.tar.gz"
	tar -xzf "$j4r/rules.tar.gz" -C "$j4r"
	fetch https://codeberg.org/SchXslt/schxslt2/releases/download/v1.11.2/schxslt2-1.11.2.zip \
		a0f5be3173113eb5ff4b5cf246fd9d1af0497a90df37023d3c0ccf60422af37c "$j4r/schxslt2.zip"
	unzip -q -o "$j4r/schxslt2.zip" -d "$j4r"
	pnpm exec xslt3 -xsl:"$j4r/schxslt2-1.11.2/transpile.xsl" -s:"$rules/jats4r.sch" -o:"$compiled"
fi

# Two findings are expected and accepted:
#  - permissions-errors asks for <permissions>. The export carries contributor
#    roles only; licence and copyright are the publisher's to write.
#  - credit-errors wants the term "Formal Analysis", but NISO's term is
#    "Formal analysis" (credit.niso.org/contributor-roles/formal-analysis/),
#    so the rules' own term list is wrong there.
findings='//*[local-name()="failed-assert" or local-name()="successful-report"]'
findings+='[not(@patternId="permissions-errors" and @test="permissions")]'
findings+='[not(@patternId="credit-errors" and contains(., "in this case Formal Analysis"))]'
report=$j4r/report.svrl
for file in "${files[@]}"; do
	pnpm exec xslt3 -xsl:"$compiled" -s:"$file" -o:"$report"
	if [[ $("${XMLLINT:-xmllint}" --xpath "count($findings)" "$report") != 0 ]]; then
		echo "$file breaks JATS4R rules (full report: $report):" >&2
		"${XMLLINT:-xmllint}" --xpath "$findings" "$report" >&2
		exit 1
	fi
done
echo "JATS4R rules: passed"
