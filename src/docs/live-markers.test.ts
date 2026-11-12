import { describe, expect, test } from "vitest";
import { splitLiveMarkers } from "./live-markers";

describe("splitLiveMarkers", () => {
  test("keeps text and repeated live blocks in reading order", () => {
    expect(splitLiveMarkers("# Guide\n\n<!-- live: quarto -->\n\nSetup.\n\n<!-- live: myst -->\nEnd.")).toEqual([
      "# Guide\n\n",
      { live: "quarto" },
      "\nSetup.\n\n",
      { live: "myst" },
      "End.",
    ]);
  });

  test.each(["quarto", "pandoc", "myst", "typst", "sphinx", "ro-crate"])("recognizes %s", (target) => {
    expect(splitLiveMarkers(`<!-- live: ${target} -->`)).toEqual([{ live: target }]);
  });

  test.each(["quartto", "jupyter-book", "", "quarto extra"])("rejects unsupported target %j", (target) => {
    expect(() => splitLiveMarkers(`<!-- live: ${target} -->`)).toThrow(/invalid live target/i);
    if (target) expect(() => splitLiveMarkers(`<!-- live: ${target} -->`)).toThrow(target);
  });

  test.each([
    "",
    "# Static\n\nNo live output.\n",
    "<!-- maintainer note -->\n\n# Guide\n",
    "Text <!-- live: quarto --> inline.\n",
    "<!-- live: quarto --> <!-- another comment -->\n",
    "<!-- note mentioning <!-- live: quarto -->\n",
    "```html\n<!-- live: invalid -->\n```\n",
    "~~~~\n<!-- live: quarto -->\n~~~~\n",
    "    <!-- live: invalid -->\n",
    "\t<!-- live: quarto -->\n",
    "> <!-- live: quarto -->\n",
    "<pre>\n<!-- live: quarto -->\n</pre>\n",
  ])("leaves ordinary Markdown untouched: %j", (source) => {
    expect(splitLiveMarkers(source)).toEqual([source]);
  });

  test("preserves ordinary comments and original line endings around whitespace-padded markers", () => {
    const before = "# Guide\r\n\r\n<!-- note -->\r\n\r\n";
    const after = "\r\nUse this.\r\n";
    expect(splitLiveMarkers(`${before}  <!--  live:  ro-crate  --> \t\r\n${after}`)).toEqual([
      before,
      { live: "ro-crate" },
      after,
    ]);
  });

  test("handles adjacent markers without empty text parts", () => {
    expect(splitLiveMarkers("<!-- live: quarto -->\n<!-- live: quarto -->\n")).toEqual([
      { live: "quarto" },
      { live: "quarto" },
    ]);
  });

  test("keeps offsets after references, code examples and mixed line endings", () => {
    const before = "[tool]: /docs/quarto\r\n\r\n```html\r\n<!-- live: invalid -->\r\n```\n\n";
    const after = "\r\n[Set up][tool].\r";
    expect(splitLiveMarkers(`${before}<!-- live: quarto -->\r${after}`)).toEqual([before, { live: "quarto" }, after]);
  });
});
