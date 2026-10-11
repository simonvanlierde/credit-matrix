#!/usr/bin/env bash
# Validates the JATS export fixture against the official JATS 1.3 Archiving
# DTD (MathML3 flavour, the one the export's DOCTYPE names). The DTD comes from
# NCBI on first run, is checked against a pinned hash, and is cached in
# .cache/. The fixture itself is written by src/core/__tests__/jats-fixture.test.ts.
set -euo pipefail

url=https://ftp.ncbi.nlm.nih.gov/pub/jats/archiving/1.3/JATS-Archiving-1-3-MathML3-DTD.zip
sha256=0c646d2eeb5fe41d8093143e6684550267d6c82e97d88bbdaea5ec2299f0bc15
cache=.cache/jats-dtd
catalog=$cache/JATS-Archiving-1-3-MathML3-DTD/catalog-jats-v1-3-no-base.xml
fixture=src/core/__tests__/fixtures/sample.jats.xml

command -v xmllint >/dev/null || {
  echo "xmllint not found (install libxml2-utils)" >&2
  exit 1
}

if [[ ! -f $catalog ]]; then
  mkdir -p "$cache"
  curl -fsSL --retry 3 -o "$cache/dtd.zip" "$url"
  echo "$sha256  $cache/dtd.zip" | shasum -a 256 -c --quiet -
  unzip -q -o "$cache/dtd.zip" -d "$cache"
fi

# The catalog maps the DOCTYPE's public identifier to the local DTD, so this
# also fails if the export names the wrong DTD.
XML_CATALOG_FILES=$catalog xmllint --nonet --noout --valid "$fixture"
echo "$fixture is valid JATS 1.3"
