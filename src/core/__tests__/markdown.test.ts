import { describe, expect, it } from "vitest";
import { DEFAULT_UI_TRANSLATOR } from "../credit-i18n/ui-strings";
import { toMarkdown } from "../export/markdown";
import { parseAuthorText } from "../parse-authors";

describe("toMarkdown", () => {
  it("renders a contributor → roles table with level annotations", () => {
    const authors = parseAuthorText("Jane Smith\nBob White");
    const [jane, bob] = authors;
    if (!(jane && bob)) throw new Error("expected 2 authors");
    const conc = jane.contributions.find((c) => c.role === "Conceptualization");
    const meth = jane.contributions.find((c) => c.role === "Methodology");
    if (!(conc && meth)) throw new Error("expected contributions");
    conc.score = 100; // lead → no annotation
    meth.score = 50; // equal → annotated

    const md = toMarkdown(authors);
    const lines = md.split("\n");
    expect(lines[0]).toBe("| Contributor | CRediT roles |");
    expect(lines[1]).toBe("| --- | --- |");
    // Level label uses the canonical English UI string (capitalized), matching
    // the statement and heatmap output.
    expect(md).toContain("| Jane Smith | Conceptualization, Methodology (Equal) |");
    // Bob has no roles → em dash placeholder
    expect(md).toContain("| Bob White | — |");
  });

  it("localizes role names and level labels via the translators", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");
    const meth = jane.contributions.find((c) => c.role === "Methodology");
    if (!meth) throw new Error("expected contribution");
    meth.score = 50; // equal → annotated

    const md = toMarkdown(
      authors,
      (name) => `«${name}»`,
      (key) => (key === "equal" ? "Égal" : DEFAULT_UI_TRANSLATOR(key)),
    );
    expect(md).toContain("«Methodology» (Égal)");
  });

  it("annotates levels with the locale's template, like the statement", () => {
    const [jane] = parseAuthorText("Jane Smith");
    const meth = jane?.contributions.find((c) => c.role === "Methodology");
    if (!(jane && meth)) throw new Error("expected author");
    meth.score = 50;

    const md = toMarkdown([jane], undefined, (key) =>
      key === "levelAnnotation" ? "{label}（{level}）" : DEFAULT_UI_TRANSLATOR(key),
    );
    expect(md).toContain("Methodology（Equal）");
  });

  it("escapes pipe characters that would break the table", () => {
    const authors = parseAuthorText("Jane Smith");
    const [jane] = authors;
    if (!jane) throw new Error("expected author");
    jane.name = "Jane | Smith";
    const conc = jane.contributions[0];
    if (!conc) throw new Error("expected contribution");
    conc.score = 100;

    expect(toMarkdown(authors)).toContain("Jane \\| Smith");
  });

  it("renders untrusted Markdown and HTML syntax as literal table text", () => {
    const [author] = parseAuthorText("Jane Smith");
    if (!author) throw new Error("expected author");
    author.name = "Jane\n[click](https://example.com) <img src=x onerror=alert(1)>";

    const md = toMarkdown([author]);

    // Header, separator, the one row, a blank line, and the generator comment:
    // the newline in the name must not have opened a fourth table line.
    expect(md.split("\n")).toHaveLength(5);
    expect(md).toContain("Jane \\[click\\](https://example.com) &lt;img src=x onerror=alert(1)&gt;");
    expect(md).not.toContain("<img");
  });
});
