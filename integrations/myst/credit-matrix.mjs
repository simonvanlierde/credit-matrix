// biome-ignore-all lint/correctness/noNodejsModules: MyST runs plugins in Node.
// MyST plugin: a `{credit-statement}` directive that renders a CRediT statement from the
// `roles` of the page's authors, or of the project's authors in myst.yml.
// MyST roles carry no degree of contribution.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildHeatmapSvg, CREDIT_ROLES, createAuthor, generateStatement, heatmapDescription } from "credit-matrix";
import {
  AVAILABLE_LOCALES,
  DEFAULT_UI_TRANSLATOR,
  loadRoleCatalog,
  loadUiCatalog,
  makeRoleTranslator,
  makeUiTranslator,
  resolveLocaleTag,
} from "credit-matrix/i18n";
import { parse } from "yaml";

// Directives run synchronously; load the catalogs once while MyST imports the plugin.
const TRANSLATORS = Object.fromEntries(
  await Promise.all(
    AVAILABLE_LOCALES.map(async ({ code }) => [
      code,
      {
        locale: code,
        translateRole: makeRoleTranslator(await loadRoleCatalog(code)),
        translateUi: makeUiTranslator(await loadUiCatalog(code)),
      },
    ]),
  ),
);

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
  return CREDIT_ROLES.find((role) => roleKey(role.name) === key)?.name ?? ALIASES[value.trim().toLowerCase()];
}

function authorName(author) {
  const { name } = author;
  if (typeof name === "string") return name;
  if (name?.literal) return name.literal;
  if (name) return [name.given, name.family].filter(Boolean).join(" ");
  return author.id ?? "";
}

/** Adapt MyST front matter to the package's authors, in canonical role order. */
export function statementEntries(authors) {
  // A single author may be a map or a string rather than a list; a bare string has no roles.
  return [].concat(authors ?? []).flatMap((author) => {
    if (typeof author !== "object" || author === null) return [];
    const raw = typeof author.roles === "string" ? author.roles.split(/[,;]/) : (author.roles ?? []);
    const roles = new Set(raw.map((r) => normalizeRole(String(r))).filter(Boolean));
    if (roles.size === 0) return [];
    const name = authorName(author).replace(/\s+/g, " ").trim();
    // MyST also permits unnamed and id-only authors; keep those display names.
    const entry = createAuthor("Contributor");
    entry.name = name;
    for (const contribution of entry.contributions) contribution.score = roles.has(contribution.role) ? 100 : 0;
    return [entry];
  });
}

/** mdast for the statement: "**Name**: Role, Role; **Name**: Role." */
export function statementNode(authors, options = {}) {
  const entries = statementEntries(authors);
  if (entries.length === 0) return [];
  const ui = options.translateUi ?? DEFAULT_UI_TRANSLATOR;
  const children = entries.flatMap((author, i) => {
    const statement = generateStatement([author], { format: "by-author", ...options });
    return [
      ...(i > 0 ? [{ type: "text", value: ui("segmentSeparator") }] : []),
      { type: "strong", children: [{ type: "text", value: author.name }] },
      { type: "text", value: statement.slice(`CRediT: ${author.name}`.length) },
    ];
  });
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
 * NOTE: authors listed by id only are not resolved against the project's list.
 */
export function authorsFor(file) {
  const page = file.endsWith(".md") ? readFrontmatter(file) : {};
  return page.authors ?? page.author ?? projectConfig(file).authors ?? [];
}

function translationsFor(file) {
  const page = file.endsWith(".md") ? readFrontmatter(file) : {};
  return TRANSLATORS[resolveLocaleTag(page.lang ?? projectConfig(file).lang) ?? "en"];
}

const creditStatement = {
  name: "credit-statement",
  doc: "A CRediT authorship statement built from the authors' `roles`.",
  run(_data, vfile) {
    return vfile?.path ? statementNode(authorsFor(vfile.path), translationsFor(vfile.path)) : [];
  },
};

const creditHeatmap = {
  name: "credit-heatmap",
  doc: "A contribution heatmap from the page's author roles.",
  options: Object.fromEntries([
    ...["color", "palette", "shape", "labels", "font", "legend-position"].map((k) => [k, { type: String }]),
    ["size", { type: Number }],
    ["font-size", { type: Number }],
    ...["legend", "levels", "horizontal", "skipempty", "initials", "marks"].map((k) => [k, { type: Boolean }]),
  ]),
  run(data, vfile) {
    if (!vfile?.path) return [];
    const entries = statementEntries(authorsFor(vfile.path));
    if (data.options?.initials) {
      const labels = entries.map((entry) =>
        /\p{L}/u.test(entry.name) ? createAuthor(entry.name).initials : entry.name,
      );
      entries.forEach((entry, i) => {
        entry.initials = labels.filter((label) => label === labels[i]).length === 1 ? labels[i] : entry.name;
      });
    }
    const options = { levels: false, acronyms: false, ...translationsFor(vfile.path), ...data.options };
    options.fontSize = options["font-size"];
    options.legendPosition = options["legend-position"];
    options.acronyms = options.initials ?? false;
    const svg = buildHeatmapSvg(entries, options);
    const name = `${createHash("sha256").update(svg).digest("hex").slice(0, 20)}.svg`;
    const dir = join(dirname(vfile.path), "_credit_matrix");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), svg);
    return [
      {
        type: "paragraph",
        children: [{ type: "image", url: `_credit_matrix/${name}`, alt: heatmapDescription(entries, options) }],
      },
    ];
  },
};

export default {
  name: "CRediT statement",
  directives: [creditStatement, creditHeatmap],
};
