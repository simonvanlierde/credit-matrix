import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Vitest runs from the repository root.
const read = (path: string) => readFileSync(path, "utf8");

// Every policy in _headers: the site-wide one, and the workers' own (the statement reader's reaches the Hub).
const csp = [...read("public/_headers").matchAll(/Content-Security-Policy: (.*)/g)]
  .map(([, policy]) => policy)
  .join("\n");
const hosts = [...csp.matchAll(/connect-src ([^;\n]*)/g)].flatMap(([, sources]) =>
  [...(sources ?? "").matchAll(/https:\/\/([^\s;]+)/g)].map(([, host]) => host ?? ""),
);
const LOCALES = ["de", "en", "es", "fr", "it", "ja", "nl", "pt-PT", "zh-Hans"];
const privacyOf = (locale: string) =>
  read(`src/locales/${locale}/messages.po`).match(/msgid "aboutPrivacy"\nmsgstr "(.*)"/)?.[1] ?? "";
const privacy = privacyOf("en");

it("reads the site's outside hosts from _headers", () => {
  expect(hosts).toContain("api.crossref.org");
  expect(hosts).toContain("huggingface.co");
  expect(privacy).not.toBe("");
});

it.each(LOCALES)("the About page's privacy text in %s names every host the browser may contact", (locale) => {
  expect(hosts.filter((host) => !privacyOf(locale).includes(host))).toEqual([]);
});

it.each([
  ["docs/architecture.md", read("docs/architecture.md")],
  ["docs/assurance-case.md", read("docs/assurance-case.md")],
])("%s names every host the browser may contact", (_, text) => {
  expect(hosts.filter((host) => !text.includes(host))).toEqual([]);
});

it("never lets the browser reach jsDelivr, since the app bundles its figure fonts", () => {
  expect(csp).not.toContain("jsdelivr");
});
