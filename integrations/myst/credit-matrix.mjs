// biome-ignore-all lint/correctness/noNodejsModules: MyST runs plugins in Node.
// MyST plugin: a `{credit-statement}` directive that renders a CRediT statement from the
// `roles` of the page's authors, or of the project's authors in myst.yml.
// Wording follows the by-author statement of the credit-matrix package
// (src/core/generate-statement.ts), English only. MyST roles carry no degree of contribution.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parse } from "yaml";

export const ROLES = [
  "Conceptualization",
  "Data curation",
  "Formal analysis",
  "Funding acquisition",
  "Investigation",
  "Methodology",
  "Project administration",
  "Resources",
  "Software",
  "Supervision",
  "Validation",
  "Visualization",
  "Writing – original draft",
  "Writing – review & editing",
];

// The aliases MyST accepts (its `credit-roles` package), so a page that builds also renders.
const ALIASES = {
  writing: "Writing – original draft",
  editing: "Writing – review & editing",
  review: "Writing – review & editing",
  analysis: "Formal analysis",
  funding: "Funding acquisition",
  admin: "Project administration",
  administration: "Project administration",
};

// Matches spelling variants the way MyST does: case, British "s" for "z", any punctuation.
const roleKey = (value) =>
  value
    .toLowerCase()
    .replaceAll("z", "s")
    .replace(/[^a-z]+/g, "-")
    .replace(/^-|-$/g, "");

export function normalizeRole(value) {
  const key = roleKey(value);
  return ROLES.find((role) => roleKey(role) === key) ?? ALIASES[value.trim().toLowerCase()];
}

function authorName(author) {
  const { name } = author;
  if (typeof name === "string") return name;
  if (name?.literal) return name.literal;
  if (name) return [name.given, name.family].filter(Boolean).join(" ");
  return author.id ?? "";
}

/** One `Name: Role, Role` entry per author with CRediT roles, in canonical role order. */
export function statementEntries(authors) {
  // A single author may be a map or a string rather than a list; a bare string has no roles.
  return [].concat(authors ?? []).flatMap((author) => {
    if (typeof author !== "object" || author === null) return [];
    const raw = typeof author.roles === "string" ? author.roles.split(/[,;]/) : (author.roles ?? []);
    const roles = new Set(raw.map((r) => normalizeRole(String(r))).filter(Boolean));
    if (roles.size === 0) return [];
    return [{ name: authorName(author), roles: ROLES.filter((r) => roles.has(r)) }];
  });
}

/** mdast for the statement: "**Name**: Role, Role; **Name**: Role." */
export function statementNode(authors) {
  const entries = statementEntries(authors);
  if (entries.length === 0) return [];
  const children = entries.flatMap(({ name, roles }, i) => [
    ...(i > 0 ? [{ type: "text", value: "; " }] : []),
    { type: "strong", children: [{ type: "text", value: name }] },
    { type: "text", value: `: ${roles.join(", ")}` },
  ]);
  children.push({ type: "text", value: "." });
  return [{ type: "paragraph", children }];
}

function readFrontmatter(file) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(readFileSync(file, "utf8"));
  return match ? (parse(match[1]) ?? {}) : {};
}

function projectConfig(file) {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const config = join(dir, "myst.yml");
    if (existsSync(config)) return parse(readFileSync(config, "utf8"))?.project ?? {};
    if (dirname(dir) === dir) return {};
  }
}

/**
 * Page authors replace project authors, as in MyST. Only Markdown pages are read for
 * front matter; a notebook page falls back to the project authors.
 * shortcut: authors listed by id only are not resolved against the project's list.
 */
export function authorsFor(file) {
  const page = file.endsWith(".md") ? readFrontmatter(file) : {};
  return page.authors ?? page.author ?? projectConfig(file).authors ?? [];
}

const creditStatement = {
  name: "credit-statement",
  doc: "A CRediT authorship statement built from the authors' `roles`.",
  run(_data, vfile) {
    return vfile?.path ? statementNode(authorsFor(vfile.path)) : [];
  },
};

export default {
  name: "CRediT statement",
  directives: [creditStatement],
};
