// biome-ignore lint/correctness/noNodejsModules: the published statement is built from this file.
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { renderMarkdown } from "./lib/markdown";

it("publishes assessment links that resolve from the accessibility page", () => {
  const html = renderMarkdown(readFileSync("docs/accessibility.md", "utf8"));
  const page = new DOMParser().parseFromString(html, "text/html");
  const links = [...page.querySelectorAll("a")].filter((link) => link.textContent === "accessibility assessment");
  expect(links).toHaveLength(1);
  for (const link of links) {
    expect(link.getAttribute("href")).toBe(
      "https://github.com/simonvanlierde/credit-matrix/blob/main/docs/accessibility-assessment.md",
    );
  }
});
