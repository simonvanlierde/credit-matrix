# Figure fonts

These regular faces provide offline fonts for editable figure exports.
Noto Sans covers Latin, Greek and Cyrillic. Credit Figure JP and SC derive from
Noto Sans JP and SC and provide Japanese and Simplified Chinese glyphs.
Use the Japanese face for Japanese labels and the
Simplified Chinese face for Chinese labels.

| File | Version | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `NotoSans-Regular.ttf` | 2.008 | 569208 | `8409b656cf2cf57ea0d218bc22bb8f9bbb855e425dd1651081c3488c39dfded6` |
| `CreditFigureJP.ttf` | 2.004 | 5794156 | `cf10690af695ffb42ac3817dcabf87fc9fe706961c51654d23d61630f9a90af6` |
| `CreditFigureSC.ttf` | 2.004 | 10642684 | `083e615a0d762b3494ef294a1fb3da65dd7b870f24c7a83eb7b62e22e41f3b3f` |

## Sources

- [Noto Sans Regular](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf),
  from `notofonts/noto-fonts` commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`.
- [Noto Sans JP variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf),
  from `notofonts/noto-cjk` commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`.
- [Noto Sans SC variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf),
  from the same CJK commit.

The CJK sources are upstream regional subsets, not subsets of the translation
catalogs. They retain characters needed for contributor names beyond those catalogs.
All nine output catalogs fit within these fonts. Arbitrary names can use scripts
or rare characters outside their coverage; check glyph coverage before export.
This set does not cover Arabic, Hebrew or Devanagari.

## Rebuild the fonts

Download the three pinned TTF sources above into `font-sources/`.
Verify their SHA-256 hashes before generating the regular faces:

| Source | SHA-256 |
| --- | --- |
| `NotoSans-Regular.ttf` | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` |
| `NotoSansJP-VF.ttf` | `f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369` |
| `NotoSansSC-VF.ttf` | `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964` |

Run this from the directory containing `font-sources/`. It writes the three regular
faces there. FontTools 4.68.0 generates the asset hashes above.

```sh
uv run --no-project --with fonttools==4.68.0 python - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

for region in ("Sans", "JP", "SC"):
    latin = region == "Sans"
    source = "NotoSans-Regular.ttf" if latin else f"NotoSans{region}-VF.ttf"
    target = "NotoSans-Regular.ttf" if latin else f"CreditFigure{region}.ttf"
    font = TTFont(f"font-sources/{source}", recalcTimestamp=False)
    if not latin:
        instantiateVariableFont(font, {"wght": 400}, inplace=True)
        family = f"Credit Figure {region}"
        postscript = f"CreditFigure{region}-Regular"
        for record in font["name"].names:
            if record.nameID in (1, 4, 6, 16):
                value = postscript if record.nameID == 6 else family
            elif record.nameID in (2, 17):
                value = "Regular"
            elif record.nameID == 3:
                value = f"{postscript};2.004"
            else:
                continue
            record.string = value.encode(record.getEncoding())
    font["glyf"].padding = 4
    font.save(target)
PY
```

Copy the outputs into this directory after checking their hashes. Keep the
four-byte glyph alignment: the PDF subsetter's short location table truncates
odd glyph offsets, which can silently drop later glyphs. The renderer embeds
complete faces in SVG and subsets their glyphs in PDF.

## Redistribution

All three fonts use the SIL Open Font License 1.1. Redistribution and document
embedding are permitted under its terms. Font embedding does not change the
document's license. Keep the license files and font copyright notices when
redistributing these assets.

- Noto Sans: Copyright 2015–2021 Google LLC. All Rights Reserved.
  [OFL-NotoSans.txt](OFL-NotoSans.txt) is the unmodified
  [upstream license](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE).
- Credit Figure JP and SC: derived from Noto Sans JP and SC,
  © 2014–2021 Adobe (http://www.adobe.com/).
  [OFL-NotoSansCJK.txt](OFL-NotoSansCJK.txt) is the unmodified
  [upstream license](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/LICENSE).

The fonts also retain their original copyright and license metadata. Their
OpenType embedding permission field (`OS/2.fsType`) is zero, with no embedding
restrictions. All three assets use TrueType outlines. The CJK derivatives retain
the sources' glyph coverage, copyright and license metadata. They use regular
weight, new family names and aligned glyph data. Noto Sans retains its family
name; its upstream license declares no Reserved Font Names.
