"""Rebuild the custom figure font fixtures from the Inter 4.1 release.

Source: https://github.com/rsms/inter/releases/download/v4.1/Inter-4.1.zip
(SHA-256 9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e), SIL Open Font
License 1.1 (OFL-Inter.txt, no Reserved Font Name). Each fixture is a printable-ASCII subset under
a new "Figure Test" family name, so no installed font can match it.

    uv run --no-project --with fonttools==4.68.0 --with brotli==1.1.0 python make.py Inter-4.1.zip

FigureTestCID-Regular.otf is the CID-keyed CFF case: "Ada 中文" from the first face of Noto Sans CJK
2.004's NotoSansCJK-Regular.ttc (SHA-256 b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a,
OFL 1.1, src/fonts/OFL-NotoSansCJK.txt), subset with fontTools' defaults so its CIDs are no longer its
glyph ids, and renamed "Figure Test CID" (name IDs 1, 4, 16; 6 FigureTestCID-Regular).
FigureTestCIDIdentity-Regular.otf is "ABCDE" from the same face with retain_gids, so its CIDs stay its
glyph ids, renamed "Figure Test CID Identity". FigureTestCFF2-Regular.otf is FigureTestCFF-Regular.otf
through fontTools.cffLib.CFFToCFF2.convertCFFToCFF2, renamed "Figure Test CFF2".
"""

import hashlib
import io
import sys
import zipfile
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTCollection, TTFont
from fontTools.varLib.instancer import instantiateVariableFont

SHA256 = "9883fdd4a49d4fb66bd8177ba6625ef9a64aa45899767dde3d36aa425756b11e"
OUT = Path(__file__).parent
archive = Path(sys.argv[1]).read_bytes()
assert hashlib.sha256(archive).hexdigest() == SHA256, "not the pinned Inter 4.1 zip"
release = zipfile.ZipFile(io.BytesIO(archive))


def load(member, index=None):
    return TTFont(io.BytesIO(release.read(member)), fontNumber=-1 if index is None else index, recalcTimestamp=False)


def cut(font):
    options = subset.Options()
    options.hinting = False
    options.name_IDs = [0, 1, 2, 3, 4, 5, 6, 16, 17]
    options.notdef_outline = True
    options.layout_features = []
    options.drop_tables += ["GSUB", "GPOS", "GDEF", "STAT", "MVAR", "HVAR"]
    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=range(0x20, 0x7F))
    subsetter.subset(font)
    return font


def rename(font, family, style="Regular"):
    postscript = f"{family.replace(' ', '')}-{style}"
    for record in font["name"].names:
        value = {1: family, 2: style, 4: f"{family} {style}", 6: postscript, 16: family, 17: style}.get(record.nameID)
        if record.nameID == 3:
            value = f"{postscript};4.100"
        if value:
            record.string = value
    return font


def regular(family, **os2):
    font = rename(cut(load("extras/ttf/Inter-Regular.ttf")), family)
    for key, value in os2.items():
        setattr(font["OS/2"], key, value)
    return font


# Unpadded glyph data, as in Inter's own release: odd glyph offsets, which fontkit's subsetter truncated.
odd = regular("Figure Test")
odd["glyf"].padding = 0
odd.save(OUT / "FigureTest-Regular.ttf")
# sFamilyClass 0x0100: class 1, oldstyle serifs.
regular("Figure Test Serif", sFamilyClass=0x0100).save(OUT / "FigureTestSerif-Regular.ttf")
regular("Figure Test Restricted", fsType=0x0002).save(OUT / "FigureTestRestricted-Regular.ttf")
regular("Figure Test No Subset", fsType=0x0100).save(OUT / "FigureTestNoSubset-Regular.ttf")
rename(cut(load("extras/otf/Inter-Regular.otf")), "Figure Test CFF").save(OUT / "FigureTestCFF-Regular.otf")

web = regular("Figure Test Web")
web.flavor = "woff2"
web.save(OUT / "FigureTestWeb-Regular.woff2")

variable = rename(cut(load("InterVariable.ttf")), "Figure Test Variable")
instantiateVariableFont(variable, {"opsz": 14}, inplace=True)
variable.save(OUT / "FigureTestVariable.ttf")
thin = rename(cut(load("InterVariable.ttf")), "Figure Test Thin")
instantiateVariableFont(thin, {"opsz": 14, "wght": (100, 100, 900)}, inplace=True)
thin["OS/2"].usWeightClass = 100
thin.save(OUT / "FigureTestThin.ttf")

# A collection whose regular face comes last, after an italic and a bold face of the same family.
collection = TTCollection()
for style, weight, selection, mac in (("Italic", 400, 0x01, 2), ("Bold", 700, 0x20, 1), ("Regular", 400, 0x40, 0)):
    face = rename(cut(load("extras/ttf/Inter-Regular.ttf")), "Figure Test Collection", style)
    face["OS/2"].usWeightClass = weight
    face["OS/2"].fsSelection = selection
    face["head"].macStyle = mac
    collection.fonts.append(face)
collection.save(OUT / "FigureTestCollection.ttc")
