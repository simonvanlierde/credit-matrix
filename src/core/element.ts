import type { Author } from "./author";
import { buildHeatmapSvg } from "./export/heatmap-svg";
import { fromJson } from "./export/json";
import { generateStatement, type StatementFormat } from "./generate-statement";
import { normalizeRoster } from "./parse-authors";

const FORMATS: readonly StatementFormat[] = ["by-role", "by-role-short", "by-author", "by-author-short"];

// The app's paper-and-ink look: IBM Plex Sans where the page has it, its neutrals otherwise.
const STYLE = `
:host { display: block; font-family: "IBM Plex Sans", "Helvetica Neue", Arial, sans-serif; color: #16181c; }
figure { margin: 0; }
svg { display: block; max-width: 100%; height: auto; border: 1px solid #e4e4e1; border-radius: 6px; }
p { margin: 0.75em 0 0; line-height: 1.5; }
.error { color: #9b1c1c; }
`;

/**
 * `<credit-matrix src="contributions.json" format="by-author">`: the CRediT
 * statement and contribution heatmap for a CRediT Matrix JSON export, read
 * from `src` or from a `<script type="application/json">` child.
 */
export class CreditMatrixElement extends HTMLElement {
  static observedAttributes = ["src", "format"];
  /** Bumped per render, so a slow fetch for an old `src` never overwrites a newer one. */
  #render = 0;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  connectedCallback() {
    void this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) void this.render();
  }

  async render() {
    const render = ++this.#render;
    const root = this.shadowRoot as ShadowRoot;
    let authors: Author[];
    try {
      const src = this.getAttribute("src");
      const json = src
        ? await (await fetch(src)).text()
        : (this.querySelector('script[type="application/json"]')?.textContent ?? "");
      authors = normalizeRoster(fromJson(json).authors);
    } catch {
      if (render !== this.#render) return;
      root.innerHTML = `<style>${STYLE}</style><p class="error" role="alert"></p>`;
      (root.querySelector("p") as HTMLElement).textContent = "Could not load the contributions.";
      return;
    }
    if (render !== this.#render) return;

    const asked = this.getAttribute("format") as StatementFormat;
    const format = FORMATS.includes(asked) ? asked : "by-role";
    // buildHeatmapSvg escapes every name and role it writes, and carries role="img" and a <title>.
    root.innerHTML = `<style>${STYLE}</style><figure>${buildHeatmapSvg(authors)}</figure>`;
    const figure = root.querySelector("figure") as HTMLElement;
    for (const line of generateStatement(authors, { format }).split("\n")) {
      const p = document.createElement("p");
      p.textContent = line;
      figure.append(p);
    }
  }
}

if (!customElements.get("credit-matrix")) customElements.define("credit-matrix", CreditMatrixElement);
