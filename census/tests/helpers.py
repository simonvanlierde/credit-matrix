"""Small JATS documents for the tests, with made-up names."""


def article(contribs: str, back: str = "") -> bytes:
    return f"""<article xmlns:xlink="http://www.w3.org/1999/xlink"><front>
<journal-meta><journal-title-group><journal-title>Test J</journal-title></journal-title-group>
<publisher><publisher-name>Test Press</publisher-name></publisher></journal-meta>
<article-meta><article-id pub-id-type="pmcid">PMC1</article-id><article-id pub-id-type="doi">10.1/x</article-id>
<contrib-group>{contribs}</contrib-group>
<pub-date><year>2024</year></pub-date>
<permissions><license xlink:href="https://creativecommons.org/licenses/by/4.0/"/></permissions>
</article-meta></front><back>{back}</back></article>""".encode()


def contrib(given: str, surname: str, inner: str = "", attrs: str = 'contrib-type="author"') -> str:
    return (
        f"<contrib {attrs}><name><surname>{surname}</surname><given-names>{given}</given-names></name>{inner}</contrib>"
    )
