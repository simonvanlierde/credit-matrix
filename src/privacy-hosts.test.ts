import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Vitest runs from the repository root.
const read = (path: string) => readFileSync(path, "utf8");

// The site-wide policy is the first CSP in _headers; the citation worker's own policy allows no outside host.
const csp = read("public/_headers").match(/Content-Security-Policy: (.*)/)?.[1] ?? "";
const hosts = [...(csp.match(/connect-src ([^;]*)/)?.[1] ?? "").matchAll(/https:\/\/([^\s;]+)/g)].map(
  ([, host]) => host ?? "",
);
const privacy = read("src/locales/en/messages.po").match(/msgid "aboutPrivacy"\nmsgstr "(.*)"/)?.[1] ?? "";

it("reads the site's outside hosts from _headers", () => {
  expect(hosts.length).toBeGreaterThan(0);
  expect(privacy).not.toBe("");
});

it.each([
  ["the About page's privacy text", privacy],
  ["docs/architecture.md", read("docs/architecture.md")],
  ["docs/assurance-case.md", read("docs/assurance-case.md")],
])("%s names every host the browser may contact", (_, text) => {
  expect(hosts.filter((host) => !text.includes(host))).toEqual([]);
});
