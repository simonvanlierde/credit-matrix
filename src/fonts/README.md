# credit-matrix-fonts

The fonts that [`credit-matrix`](../core/README.md) embeds in heatmap SVG and PDF exports. Install
this package next to it to export figures offline, with no download:

```sh
npm i credit-matrix credit-matrix-fonts
```

Without it, `credit-matrix` downloads each face from this package's release on jsDelivr the first
time a figure needs it, and caches it. In a bundled app, pass the `fonts` export to
`createFigureRenderer({ fonts })`: each face is a `new URL("./X.ttf", import.meta.url)`, so the
bundler emits it as an asset. A release comes only when the fonts change, and `credit-matrix` pins
the version and the hashes below.

These regular faces provide offline fonts for editable figure exports. Arabic,
Armenian, Bengali, Devanagari, Ethiopic, Georgian, Gujarati, Gurmukhi, Hebrew,
Kannada, Khmer, Lao, Malayalam, Myanmar, Oriya, Sinhala, Tamil, Telugu and Thai
each have a Noto Sans face for sans figures and a Noto Serif face (Noto Naskh
Arabic for Arabic) for serif figures. Korean (Credit Figure KR, from Noto Sans
KR) and monochrome emoji (Credit Figure Emoji, from Noto Emoji) have one face,
used in sans and serif figures alike: a serif Korean face would add 14 MB. `harfbuzz.wasm` is the HarfBuzz shaping
engine, which lays out the complex scripts; it comes through the same `fonts`
provider, so it is fetched only for a figure that needs it.
Noto Sans and Serif cover Latin, Greek and Cyrillic. Credit Figure JP and SC
derive from Noto Sans JP and SC; Credit Figure Serif JP and SC derive from
Noto Serif JP and SC. Both families provide Japanese and Simplified Chinese glyphs.
Use the Japanese face for Japanese labels and the
Simplified Chinese face for Chinese labels.

| File | Face | Version | Bytes | SHA-256 |
| --- | --- | --- | ---: | --- |
| `NotoSans-Regular.ttf` | `sans` | 2.008 | 569208 | `8409b656cf2cf57ea0d218bc22bb8f9bbb855e425dd1651081c3488c39dfded6` |
| `CreditFigureJP.ttf` | `sans-jp` | 2.004 | 5794156 | `cf10690af695ffb42ac3817dcabf87fc9fe706961c51654d23d61630f9a90af6` |
| `CreditFigureSC.ttf` | `sans-sc` | 2.004 | 10642684 | `083e615a0d762b3494ef294a1fb3da65dd7b870f24c7a83eb7b62e22e41f3b3f` |
| `NotoSerif-Regular.ttf` | `serif` | 2.007 | 616196 | `c8f669ceb2c9c60ccf55198b305e08a997ffca79a38cc7eeb551e643cbe66505` |
| `CreditFigureSerifJP.ttf` | `serif-jp` | 2.003 | 8103576 | `127d13be2fcb997f01ec56ce361e5808a63ee74fbcd94be8262bebbb90aa95d3` |
| `CreditFigureSerifSC.ttf` | `serif-sc` | 2.003 | 14897976 | `9e4eadf4a90c36eaf7f69ef1c0d29fd6b8277eed55f5a035b95232e5243cdd34` |
| `CreditFigureKR.ttf` | `sans-kr` | 2.004 | 6262808 | `134e926bd335ede61927ad3e5209fd9f0b4381c78decd26bc39462af7a8ed640` |
| `NotoSansArabic-Regular.ttf` | `sans-arabic` | 2.013 | 234892 | `bdff3e5659d67e67def05b33f749683b9376ae819d65d3dd62ac4640b3aaef48` |
| `NotoSansArmenian-Regular.ttf` | `sans-armenian` | 2.008 | 30752 | `720df88c332417a235b4d6209d14ec2e2bf4bfe2a954b7453d869ea593bfce1e` |
| `NotoSansBengali-Regular.ttf` | `sans-bengali` | 3.011 | 143072 | `b55c62ee531e3214da6c0701daecea89a52ba42db7d8206b92e6b51f397a3193` |
| `NotoSansDevanagari-Regular.ttf` | `sans-devanagari` | 2.007 | 243520 | `4e3c66638958c3e2ab5d37f47a8deb89fffeb7be9985c665a519bbc7ba762313` |
| `NotoSansEthiopic-Regular.ttf` | `sans-ethiopic` | 2.102 | 376804 | `f6f7fc379db9438959a2b0527e7a2cf36ea9c84626d56ec444fff37fc24c3c10` |
| `NotoSansGeorgian-Regular.ttf` | `sans-georgian` | 2.005 | 52888 | `d3e33254b09e7bb2c5cf0f17e554b80462056c5a107097f258d495168c3a9346` |
| `NotoSansGujarati-Regular.ttf` | `sans-gujarati` | 2.106 | 200704 | `9b5a7aaeeb649a2e75a49d8b006a1f87db1b61c0df3b001609f4e0725d88dbf6` |
| `NotoSansGurmukhi-Regular.ttf` | `sans-gurmukhi` | 2.004 | 55172 | `658d0207da305a1411c539a8b0bbeda64d4146e54fb4827facddb890b6b90d74` |
| `NotoSansHebrew-Regular.ttf` | `sans-hebrew` | 3.001 | 26860 | `cdefaf8efd47045f6820928eba84db5bed7557539328952b5f828315485e02ee` |
| `NotoSansKannada-Regular.ttf` | `sans-kannada` | 2.006 | 182416 | `9ad74dc64838c6855b96f671fc08e425a58921b9d0c71712ea79c328a27e6e38` |
| `NotoSansKhmer-Regular.ttf` | `sans-khmer` | 2.004 | 114576 | `e66675f2082788f0511a714bef5a1748928294b38c8e286a96ea73a864b5e605` |
| `NotoSansLao-Regular.ttf` | `sans-lao` | 2.003 | 35884 | `0a86e5e1ccfe34ca78c43fac6829dc751b42bcc469272a9a55325aae587bfbe7` |
| `NotoSansMalayalam-Regular.ttf` | `sans-malayalam` | 2.104 | 112936 | `c08de7fa8d032a5d6a4d120fb82c78cec60b362a4e73fa26360d89759ff2a7f9` |
| `NotoSansMyanmar-Regular.ttf` | `sans-myanmar` | 2.107 | 195088 | `fafce4db400bc0b214907ccdbfb0ad2f18a57bfefd08c8a571830b84088cf2fc` |
| `NotoSansOriya-Regular.ttf` | `sans-oriya` | 2.007 | 131216 | `a16645d056017927406546aa78e4ce15e782fd8783467267b75450453d007415` |
| `NotoSansSinhala-Regular.ttf` | `sans-sinhala` | 3.000 | 154912 | `9e32612d47004552f3125e78648a9e2e7899a216ccd3cefbb93a9b5f4c809feb` |
| `NotoSansTamil-Regular.ttf` | `sans-tamil` | 2.004 | 73992 | `3c0a186feb3c63c7f6d63e1511dcdc144e745ae09b98e217c83f3e317974f6f9` |
| `NotoSansTelugu-Regular.ttf` | `sans-telugu` | 2.005 | 235176 | `b274780b69d1d23fe84b55e809a152cb2ac5306d33864b1f87622f6971871aae` |
| `NotoSansThai-Regular.ttf` | `sans-thai` | 2.002 | 37780 | `61cf814eec46b294d6ea4401ac295d0cecd5207bd2331dcc5a15e7301d30ee44` |
| `NotoNaskhArabic-Regular.ttf` | `serif-arabic` | 2.021 | 247336 | `6f0a92031367b2f5a2078fe9d24f3433122b61a0bad57c423aad8f3c39aa2e6e` |
| `NotoSerifArmenian-Regular.ttf` | `serif-armenian` | 2.008 | 31040 | `6dc71b17c55d398c7cc88edeec527292ba1e0573b033ac2136c636ab36c27d76` |
| `NotoSerifBengali-Regular.ttf` | `serif-bengali` | 3.000 | 324020 | `c1743dce480147e4563e479ddc31d5ff6544372437428622a54c7c867c50f55b` |
| `NotoSerifDevanagari-Regular.ttf` | `serif-devanagari` | 2.006 | 280180 | `e272d11d271c61a8d5d0f65764fd368ae53b9f9dabcce244a8941aa8f32ccc70` |
| `NotoSerifEthiopic-Regular.ttf` | `serif-ethiopic` | 2.102 | 309844 | `4d14f10b7436e762d41ddd9486acdc708744bf377a575d855b81b847b9590779` |
| `NotoSerifGeorgian-Regular.ttf` | `serif-georgian` | 2.003 | 61956 | `e222862f34ad05bdf950de1049abf6149d250b9e27c1cc482dd645412afb64ff` |
| `NotoSerifGujarati-Regular.ttf` | `serif-gujarati` | 2.106 | 146056 | `b8961ff6faf8e5561e3d0109953c4a9798e9bb8e8d48f66c3d1ef038fe45c940` |
| `NotoSerifGurmukhi-Regular.ttf` | `serif-gurmukhi` | 2.004 | 53316 | `5ef2d04a6d6fd22959989d14148dcf0ffbb970cc35e6316ba63cd5c146f32667` |
| `NotoSerifHebrew-Regular.ttf` | `serif-hebrew` | 2.004 | 30288 | `dfd5a6aefe97a99f68fe43388342913d50bb9fbf6d3afc4d2c7725661bc4a2b1` |
| `NotoSerifKannada-Regular.ttf` | `serif-kannada` | 2.005 | 194376 | `95a78c95359dc59b9ec56bdc5bdf8a9642394d2ef87ded945fb3885893b3eac6` |
| `NotoSerifKhmer-Regular.ttf` | `serif-khmer` | 2.004 | 154372 | `ef0612212c7417da732dd43c744abf66f4f62c45d4f8962e42c8553230e0da2a` |
| `NotoSerifLao-Regular.ttf` | `serif-lao` | 2.003 | 42880 | `a8d38866520f3c96d0e0e43f079f16c72ae4963bbabdf21cae26092c7cb65ec7` |
| `NotoSerifMalayalam-Regular.ttf` | `serif-malayalam` | 2.104 | 111872 | `45c34ac8c169a37a4fbb5b8fbf507def328bbf36180b08095726d460d577ec1d` |
| `NotoSerifMyanmar-Regular.ttf` | `serif-myanmar` | 2.106 | 277152 | `fe1a5f1c9cafab515e89e20f884aee3681ccd9f3f2e7bf357c6758d9268535a5` |
| `NotoSerifOriya-Regular.ttf` | `serif-oriya` | 1.051 | 148896 | `c674ab8038d1e51e783fdd7192fd39ae8a2aa48701589955bdabd627c0c3eb13` |
| `NotoSerifSinhala-Regular.ttf` | `serif-sinhala` | 2.007 | 325860 | `0d5a63d34ed378e345ec96021d72385c8e288ecd0ea36511a329aed448ede375` |
| `NotoSerifTamil-Regular.ttf` | `serif-tamil` | 2.004 | 79476 | `8a8cb015a3afec2998e01aabcb42fb365994132d95dbc2150208b4fefd8dc2e4` |
| `NotoSerifTelugu-Regular.ttf` | `serif-telugu` | 2.005 | 311724 | `2b376e0351fb140f2edad9c54e8977f4f1effc4fe72443e152b3f6ad392c6f5f` |
| `NotoSerifThai-Regular.ttf` | `serif-thai` | 2.002 | 45424 | `747b5bb1fdd329850ddd3218d872a3d2a96ab0dd544f51e5300c6d1b12071b62` |
| `CreditFigureEmoji.ttf` | `emoji` | 3.002 | 889044 | `e35e380f5ea3d23efb4c9093ced5d5600d1af059feab7fc130ad10824d99416d` |
| `harfbuzz.wasm` | `harfbuzz` | harfbuzzjs 1.6.4 | 444394 | `6eeed8e1bc9ad7773038e48ff8f9e07e0ad228572c594b45e5357e9c2f7a0b2e` |

## Sources

- [Noto Sans Regular](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSans/NotoSans-Regular.ttf),
  from `notofonts/noto-fonts` commit `ffebf8c1ee449e544955a7e813c54f9b73848eac`.
- [Noto Sans JP variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansJP-VF.ttf),
  from `notofonts/noto-cjk` commit `f8d157532fbfaeda587e826d4cd5b21a49186f7c`.
- [Noto Sans SC variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf),
  from the same CJK commit.
- [Noto Serif Regular](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/hinted/ttf/NotoSerif/NotoSerif-Regular.ttf),
  from the same `noto-fonts` commit.
- [Noto Serif JP variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/Variable/TTF/Subset/NotoSerifJP-VF.ttf)
  and [Noto Serif SC variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/Variable/TTF/Subset/NotoSerifSC-VF.ttf),
  from the same CJK commit.

- The 19 `NotoSans<Script>-Regular.ttf` faces, unmodified, from
  `notofonts/notofonts.github.io` commit `4cf78353cd1668040ba8efa13029cd910fcdf9e2`, at
  `fonts/NotoSans<Script>/hinted/ttf/NotoSans<Script>-Regular.ttf` (for example
  [Noto Sans Arabic](https://raw.githubusercontent.com/notofonts/notofonts.github.io/4cf78353cd1668040ba8efa13029cd910fcdf9e2/fonts/NotoSansArabic/hinted/ttf/NotoSansArabic-Regular.ttf)).
- The 19 serif script faces, unmodified, from the same `notofonts.github.io` commit, at
  `fonts/NotoSerif<Script>/hinted/ttf/NotoSerif<Script>-Regular.ttf`, and for Arabic
  `fonts/NotoNaskhArabic/hinted/ttf/NotoNaskhArabic-Regular.ttf` (for example
  [Noto Serif Devanagari](https://raw.githubusercontent.com/notofonts/notofonts.github.io/4cf78353cd1668040ba8efa13029cd910fcdf9e2/fonts/NotoSerifDevanagari/hinted/ttf/NotoSerifDevanagari-Regular.ttf)).
- [Noto Sans KR variable TTF](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Sans/Variable/TTF/Subset/NotoSansKR-VF.ttf),
  from the same CJK commit.
- [Noto Emoji variable TTF](https://raw.githubusercontent.com/google/fonts/c30b221beb0c1da59d563feb91ec8656a1fa972a/ofl/notoemoji/NotoEmoji%5Bwght%5D.ttf),
  from `google/fonts` commit `c30b221beb0c1da59d563feb91ec8656a1fa972a`.
- `harfbuzz.wasm`, unmodified, from the [harfbuzzjs](https://github.com/harfbuzz/harfbuzzjs) 1.6.4 npm package.

The CJK sources are upstream regional subsets, not subsets of the translation
catalogs. They retain characters needed for contributor names beyond those catalogs.
All nine output catalogs fit within these fonts. Names can still use scripts
outside this set, such as Tibetan or Cherokee. Export then stops with a `FigureFontError`
that names the missing characters; the CLI and the MyST plugin print it as one line.
The app turns off only its PDF download and draws the SVG and PNG in system fonts.

## Rebuild the fonts

Download the six pinned TTF sources above into `font-sources/`.
Verify their SHA-256 hashes before generating the regular faces:

| Source | SHA-256 |
| --- | --- |
| `NotoSans-Regular.ttf` | `b85c38ecea8a7cfb39c24e395a4007474fa5a4fc864f6ee33309eb4948d232d5` |
| `NotoSansJP-VF.ttf` | `f4b373b226668ee33a6e54b02823dcd2d1209f17159f777421ae8c2275160369` |
| `NotoSansSC-VF.ttf` | `d68bafcb48a2707749396aa12bbbd833cb70401f3a9a689fd2902c7e0d295964` |
| `NotoSerif-Regular.ttf` | `c8f669ceb2c9c60ccf55198b305e08a997ffca79a38cc7eeb551e643cbe66505` |
| `NotoSerifJP-VF.ttf` | `99999f906b3793c7c97661a05ef9d53488d488604683b308c756d084b71df7d1` |
| `NotoSerifSC-VF.ttf` | `5326cfb097e3ab26fcb39329752b5c0a439bf8d5c4649520e4b492939c352a09` |

Run this from the directory containing `font-sources/`. It writes the six regular
faces there. FontTools 4.68.0 generates the asset hashes above.

```sh
uv run --no-project --with fonttools==4.68.0 python - <<'PY'
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from itertools import product

for family, region in product(("Sans", "Serif"), ("", "JP", "SC")):
    latin = not region
    source = f"Noto{family}-Regular.ttf" if latin else f"Noto{family}{region}-VF.ttf"
    prefix = "" if family == "Sans" else "Serif"
    target = f"Noto{family}-Regular.ttf" if latin else f"CreditFigure{prefix}{region}.ttf"
    font = TTFont(f"font-sources/{source}", recalcTimestamp=False)
    if not latin:
        instantiateVariableFont(font, {"wght": 400}, inplace=True)
        family_name = f"Credit Figure {'Serif ' if family == 'Serif' else ''}{region}"
        postscript = f"CreditFigure{prefix}{region}-Regular"
        for record in font["name"].names:
            if record.nameID in (1, 4, 6, 16):
                value = postscript if record.nameID == 6 else family_name
            elif record.nameID in (2, 17):
                value = "Regular"
            elif record.nameID == 3:
                value = f"{postscript};{font['head'].fontRevision:.3f}"
            else:
                continue
            record.string = value.encode(record.getEncoding())
    font["glyf"].padding = 4
    font.save(target)
PY
```

Credit Figure KR and Emoji come from `NotoSansKR-VF.ttf` (SHA-256
`9e1d729e7e2b36f9ef439da102f8c134c10aabe46f1c843bf0aca5c043b86f76`) and
`NotoEmoji[wght].ttf` (SHA-256
`de6c18832938afc99caf132b39d6a30a19bac7f2e812e28db2535b4608d27551`)
the same way: instanced at weight 400, renamed "Credit Figure KR" and "Credit Figure Emoji"
(PostScript `CreditFigureKR-Regular`, `CreditFigureEmoji-Regular`), and saved with four-byte padding.

Copy the outputs into this directory after checking their hashes. Keep the
four-byte glyph alignment: the PDF subsetter's short location table truncates
odd glyph offsets, which can silently drop later glyphs. The renderer subsets
the glyphs a figure uses, in SVG and in PDF.

## Redistribution

All the fonts use the SIL Open Font License 1.1. Redistribution and document
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
- Noto Serif: Copyright 2015–2021 Google LLC. All Rights Reserved.
  [OFL-NotoSans.txt](OFL-NotoSans.txt) also supplies its unmodified
  [upstream license](https://raw.githubusercontent.com/notofonts/noto-fonts/ffebf8c1ee449e544955a7e813c54f9b73848eac/LICENSE).
- Credit Figure Serif JP and SC: derived from Noto Serif JP and SC,
  © 2017–2024 Adobe (http://www.adobe.com/).
  [OFL-NotoSerifCJK.txt](OFL-NotoSerifCJK.txt) is the unmodified
  [upstream license](https://raw.githubusercontent.com/notofonts/noto-cjk/f8d157532fbfaeda587e826d4cd5b21a49186f7c/Serif/LICENSE).

- The other sans and serif script faces, Credit Figure KR and Credit Figure Emoji:
  [OFL-NotoScripts.txt](OFL-NotoScripts.txt) lists each face's own copyright line
  above the license text. Credit Figure KR, like JP and SC, avoids the reserved
  font name "Source".
- `harfbuzz.wasm` is MIT (harfbuzzjs) and "Old MIT" (HarfBuzz):
  [LICENSE-harfbuzz.txt](LICENSE-harfbuzz.txt).

The fonts also retain their original copyright and license metadata. Their
OpenType embedding permission field (`OS/2.fsType`) is zero, with no embedding
restrictions. All the faces use TrueType outlines. The CJK derivatives retain
the sources' glyph coverage, copyright and license metadata. They use regular
weight, new family names and aligned glyph data. Noto Sans and Serif retain their
family names; their upstream license declares no Reserved Font Names.
