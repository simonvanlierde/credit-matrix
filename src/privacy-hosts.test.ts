import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Vitest runs from the repository root.
const read = (path: string) => readFileSync(path, "utf8");

// The site-wide policy is the first CSP in _headers; the citation worker's own policy allows no outside host.
const csp = read("public/_headers").match(/Content-Security-Policy: (.*)/)?.[1] ?? "";
const hosts = [...(csp.match(/connect-src ([^;]*)/)?.[1] ?? "").matchAll(/https:\/\/([^\s;]+)/g)].map(
  ([, host]) => host ?? "",
);
const LOCALES = ["de", "en", "es", "fr", "it", "ja", "nl", "pt-PT", "zh-Hans"];
const privacyOf = (locale: string) =>
  read(`src/locales/${locale}/messages.po`).match(/msgid "aboutPrivacy"\nmsgstr "(.*)"/)?.[1] ?? "";
const privacy = privacyOf("en");

it("reads the site's outside hosts from _headers", () => {
  expect(hosts.length).toBeGreaterThan(0);
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
