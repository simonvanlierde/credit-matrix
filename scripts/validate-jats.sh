#!/usr/bin/env bash
# Validates the JATS export fixture twice:
#   1. against the official JATS 1.3 Archiving DTD (MathML3 flavour, the one
#      the export's DOCTYPE names), with xmllint;
#   2. against the JATS4R Schematron rules (MIT, github.com/jats4r/jats-schematrons),
#      compiled to XSLT with SchXslt2 (MIT) and run with SaxonJS (the xslt3
#      dev dependency), because the rules need XPath 2.0, which xmllint lacks.
# Every download comes on first run, is checked against a pinned hash, and is
# cached in .cache/. The fixture itself is written by
# src/core/__tests__/jats-fixture.test.ts.
set -euo pipefail

fixture=src/core/__tests__/fixtures/sample.jats.xml

# fetch <url> <sha256> <dest>
fetch() {
  curl -fsSL --retry 3 -o "$3" "$1"
  echo "$2  $3" | shasum -a 256 -c --quiet -
}

command -v xmllint >/dev/null || {
  echo "xmllint not found (install libxml2-utils)" >&2
  exit 1
}

# 1. DTD
dtd=.cache/jats-dtd
catalog=$dtd/JATS-Archiving-1-3-MathML3-DTD/catalog-jats-v1-3-no-base.xml
if [[ ! -f $catalog ]]; then
  mkdir -p "$dtd"
  fetch https://ftp.ncbi.nlm.nih.gov/pub/jats/archiving/1.3/JATS-Archiving-1-3-MathML3-DTD.zip \
    0c646d2eeb5fe41d8093143e6684550267d6c82e97d88bbdaea5ec2299f0bc15 "$dtd/dtd.zip"
  unzip -q -o "$dtd/dtd.zip" -d "$dtd"
fi

# The catalog maps the DOCTYPE's public identifier to the local DTD, so this
# also fails if the export names the wrong DTD.
XML_CATALOG_FILES=$catalog xmllint --nonet --noout --valid "$fixture"
echo "$fixture is valid JATS 1.3"

# 2. JATS4R rules
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

report=$j4r/report.svrl
pnpm exec xslt3 -xsl:"$compiled" -s:"$fixture" -o:"$report"

# Two findings are expected and accepted:
#  - permissions-errors asks for <permissions>. The export carries contributor
#    roles only; licence and copyright are the publisher's to write.
#  - credit-errors wants the term "Formal Analysis", but NISO's term is
#    "Formal analysis" (credit.niso.org/contributor-roles/formal-analysis/),
#    so the rules' own term list is wrong there.
findings='//*[local-name()="failed-assert" or local-name()="successful-report"]'
findings+='[not(@patternId="permissions-errors" and @test="permissions")]'
findings+='[not(@patternId="credit-errors" and contains(., "in this case Formal Analysis"))]'
if [[ $(xmllint --xpath "count($findings)" "$report") != 0 ]]; then
  echo "$fixture breaks JATS4R rules (full report: $report):" >&2
  xmllint --xpath "$findings" "$report" >&2
  exit 1
fi
echo "$fixture passes the JATS4R rules"
