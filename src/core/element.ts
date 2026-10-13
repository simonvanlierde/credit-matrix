import { type Author, MAX_IMPORT_BYTES, rolesWithContributions, scoreToLevel } from "./author";
import {
  hasCatalog,
  type LocaleCode,
  loadRoleCatalog,
  makeRoleTranslator,
  normalizeLocaleCode,
} from "./credit-i18n/index";
import { loadUiCatalog, makeUiTranslator, type UiTranslator } from "./credit-i18n/ui-strings";
import { buildHeatmapSvg } from "./export/heatmap-svg";
import { fromJson } from "./export/json";
import { generateStatement, STATEMENT_FORMATS, type StatementFormat } from "./generate-statement";
import { normalizeRoster } from "./parse-authors";

// The app's paper-and-ink look: IBM Plex Sans where the page has it, its neutrals otherwise.
// The element is its own card, so its text keeps its contrast on a dark page too.
const STYLE = `
:host { display: block; font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; color: #16181c; background: #fafaf9; padding: 1rem; border-radius: 8px; }
:host([hidden]) { display: none; }
figure { margin: 0; position: relative; }
.scroll { overflow-x: auto; }
.scroll:focus-visible { outline: 2px solid #16181c; outline-offset: 2px; }
svg { display: block; border: 1px solid #e4e4e1; border-radius: 6px; }
p { margin: 0.75em 0 0; line-height: 1.5; }
style + p { margin-top: 0; }
.error { color: #9b1c1c; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
`;

/** A failure to fetch `src`, as opposed to data that is not an export. */
class LoadError extends Error {}

/**
 * An offered locale for a language tag. A regional tag such as `de-DE` falls
 * back to its language when that has a catalog; anything else is English.
 */
function resolveLocale(tag: string | null | undefined): LocaleCode {
  const exact = normalizeLocaleCode(tag);
  const base = tag?.split("-")[0] ?? "";
  return exact === "en" && hasCatalog(base) ? base : exact;
}

async function fetchJson(src: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(src);
  } catch {
    throw new LoadError(`Could not load ${src} (network error).`);
  }
  if (!res.ok) throw new LoadError(`Could not load ${src} (HTTP ${res.status}).`);
  const tooBig = new LoadError(`Could not load ${src}: it is larger than ${MAX_IMPORT_BYTES / 1_000_000} MB.`);
  if (Number(res.headers.get("content-length")) > MAX_IMPORT_BYTES) throw tooBig;
  const text = await res.text();
  if (text.length > MAX_IMPORT_BYTES) throw tooBig;
  return text;
}

function englishParagraph(text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.lang = "en";
  if (className) p.className = className;
  p.textContent = text;
  return p;
}

/** The heatmap as a table, for screen readers: a row per role, a column per contributor, levels in the cells. */
function levelTable(authors: Author[], translateRole: (name: string) => string, translateUi: UiTranslator) {
  // Hidden through a wrapper: a table ignores its own width and overflow, and would widen the page.
  const wrapper = document.createElement("div");
  wrapper.className = "sr-only";
  const table = wrapper.appendChild(document.createElement("table"));
  table.createCaption().textContent = translateUi("heatmapTitle");
  const head = table.createTHead().insertRow();
  head.append(document.createElement("td"));
  for (const author of authors) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = author.name;
    head.append(th);
  }
  const body = table.createTBody();
  for (const role of rolesWithContributions(authors)) {
    const row = body.insertRow();
    const th = document.createElement("th");
    th.scope = "row";
    th.textContent = translateRole(role);
    row.append(th);
    for (const author of authors) {
      const score = author.contributions.find((c) => c.role === role)?.score ?? 0;
      row.insertCell().textContent = translateUi(scoreToLevel(score));
    }
  }
  return wrapper;
}

/**
 * `<credit-matrix src="contributions.json" format="by-author" locale="fr">`:
 * the CRediT statement and contribution heatmap for a CRediT Matrix JSON
 * export, read from `src` or from a `<script type="application/json">` child.
 */
export class CreditMatrixElement extends HTMLElement {
  static observedAttributes = ["src", "format", "locale"];
  /** Bumped per render, so a slow fetch or catalog load for an old render never overwrites a newer one. */
  #render = 0;
  #style = document.createElement("style");
  /** Re-renders when inline JSON is added or edited after the element connected. */
  #children = new MutationObserver(() => {
    if (!this.hasAttribute("src")) void this.render();
  });

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.#style.textContent = STYLE;
  }

  connectedCallback() {
    this.#children.observe(this, { childList: true, characterData: true, subtree: true });
    void this.render();
  }

  disconnectedCallback() {
    this.#children.disconnect();
  }

  attributeChangedCallback() {
    if (this.isConnected) void this.render();
  }

  #show(...nodes: Node[]) {
    (this.shadowRoot as ShadowRoot).replaceChildren(this.#style, ...nodes);
  }

  async render() {
    const render = ++this.#render;
    const src = this.getAttribute("src");
    const locale = resolveLocale(this.getAttribute("locale") ?? this.closest("[lang]")?.getAttribute("lang"));
    if (src) this.#show(englishParagraph("Loading contributions…"));

    // A catalog that fails to load leaves that part in English rather than failing the render.
    const catalogs = Promise.all([loadRoleCatalog(locale).catch(() => null), loadUiCatalog(locale).catch(() => null)]);
    let authors: Author[];
    try {
      const json = src
        ? await fetchJson(src)
        : (this.querySelector('script[type="application/json"]')?.textContent ?? "");
      try {
        authors = normalizeRoster(fromJson(json).authors);
      } catch {
        throw new Error(
          src ? `${src} is not a CRediT Matrix export.` : "The JSON in this element is not a CRediT Matrix export.",
        );
      }
    } catch (error) {
      if (render !== this.#render) return;
      const alert = englishParagraph((error as Error).message, "error");
      alert.setAttribute("role", "alert");
      this.#show(alert);
      return;
    }
    const [roleCatalog, uiCatalog] = await catalogs;
    if (render !== this.#render) return;

    const translateRole = makeRoleTranslator(roleCatalog);
    const translateUi = makeUiTranslator(uiCatalog);
    const asked = this.getAttribute("format") as StatementFormat;
    const format = STATEMENT_FORMATS.includes(asked) ? asked : "by-role";

    const figure = document.createElement("figure");
    figure.lang = locale;
    // Scrolls rather than shrinks on a narrow page, so the labels keep their size.
    const scroll = document.createElement("div");
    scroll.className = "scroll";
    scroll.tabIndex = 0;
    scroll.setAttribute("role", "group");
    scroll.setAttribute("aria-label", translateUi("heatmapTitle"));
    // buildHeatmapSvg escapes every name and role it writes. The table below carries its content for screen readers.
    scroll.innerHTML = buildHeatmapSvg(authors, { translateRole, translateUi });
    scroll.firstElementChild?.setAttribute("aria-hidden", "true");
    figure.append(scroll, levelTable(authors, translateRole, translateUi));
    for (const line of generateStatement(authors, { format, locale, translateRole, translateUi }).split("\n")) {
      const p = document.createElement("p");
      p.textContent = line;
      figure.append(p);
    }
    this.#show(figure);
  }
}

if (!customElements.get("credit-matrix")) customElements.define("credit-matrix", CreditMatrixElement);
