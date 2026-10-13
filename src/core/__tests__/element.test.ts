// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "../element";
import { MAX_IMPORT_BYTES } from "../author";
import { toJson } from "../export/json";
import { createAuthor } from "../parse-authors";

const json = toJson([
  createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] }),
  createAuthor("Bob <White>", { contributions: [{ role: "Investigation", score: 100 }] }),
]);

async function mount(html: string): Promise<ShadowRoot> {
  document.body.innerHTML = html;
  const element = document.querySelector("credit-matrix") as HTMLElement & { render(): Promise<void> };
  await element.render();
  return element.shadowRoot as ShadowRoot;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("<credit-matrix>", () => {
  it("renders the heatmap as a labelled image and the statement as text, from inline JSON", async () => {
    const root = await mount(`<credit-matrix><script type="application/json">${json}</script></credit-matrix>`);
    const svg = root.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.querySelector("title")?.textContent).toBe("Contribution heatmap");
    expect(root.querySelector("p")?.textContent).toBe("CRediT: Investigation: Bob <White>; Software: Jane Smith");
  });

  it("fetches src and follows the format attribute", async () => {
    const fetch = vi.fn(async () => new Response(json));
    vi.stubGlobal("fetch", fetch);
    try {
      const root = await mount('<credit-matrix src="team.json" format="by-author-short"></credit-matrix>');
      expect(fetch).toHaveBeenCalledWith("team.json");
      expect(root.querySelector("p")?.textContent).toBe("CRediT: JS: Software; BW: Investigation");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("says so when the inline data is not an export", async () => {
    const root = await mount("<credit-matrix><script type='application/json'>{</script></credit-matrix>");
    expect(root.querySelector("[role=alert]")?.textContent).toBe(
      "The JSON in this element is not a CRediT Matrix export.",
    );
  });

  it("says so when the src cannot be fetched or there is no data at all", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        return Promise.reject(new Error("offline"));
      }),
    );
    try {
      const root = await mount('<credit-matrix src="team.json"></credit-matrix>');
      expect(root.querySelector("[role=alert]")?.textContent).toBe("Could not load team.json (network error).");
    } finally {
      vi.unstubAllGlobals();
    }
    const empty = await mount("<credit-matrix></credit-matrix>");
    expect(empty.querySelector("[role=alert]")).not.toBeNull();
  });

  it("falls back to by-role for an unknown format", async () => {
    const root = await mount(
      `<credit-matrix format="sideways"><script type="application/json">${json}</script></credit-matrix>`,
    );
    expect(root.querySelector("p")?.textContent).toBe("CRediT: Investigation: Bob <White>; Software: Jane Smith");
  });

  it("re-renders when src changes while connected, and not before it is connected", async () => {
    const fetch = vi.fn(async () => new Response(json));
    vi.stubGlobal("fetch", fetch);
    try {
      const loose = document.createElement("credit-matrix");
      loose.setAttribute("src", "a.json");
      expect(fetch).not.toHaveBeenCalled();

      document.body.append(loose);
      await vi.waitFor(() => expect(loose.shadowRoot?.querySelector("svg")).not.toBeNull());
      loose.setAttribute("format", "by-author");
      await vi.waitFor(() => expect(loose.shadowRoot?.querySelector("p")?.textContent).toMatch(/^CRediT: Jane Smith/));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets a newer src win over a slower, failing older one", async () => {
    let failOld: () => void = () => undefined;
    const fetch = vi.fn(async (src: string) =>
      src === "old.json"
        ? new Promise<Response>((_, reject) => {
            failOld = () => reject(new Error("late"));
          })
        : new Response(json),
    );
    vi.stubGlobal("fetch", fetch);
    try {
      document.body.innerHTML = '<credit-matrix src="old.json"></credit-matrix>';
      const element = document.querySelector("credit-matrix") as HTMLElement & { render(): Promise<void> };
      const old = element.render();
      element.setAttribute("src", "new.json");
      await vi.waitFor(() => expect(element.shadowRoot?.querySelector("svg")).not.toBeNull());
      failOld();
      await old;
      expect(element.shadowRoot?.querySelector("[role=alert]")).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("tells a failed request apart from a file that is not an export", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (src: string) => (src === "gone.json" ? new Response("", { status: 404 }) : new Response("<html>"))),
    );
    try {
      const gone = await mount('<credit-matrix src="gone.json"></credit-matrix>');
      expect(gone.querySelector("[role=alert]")?.textContent).toBe("Could not load gone.json (HTTP 404).");
      const page = await mount('<credit-matrix src="page.html"></credit-matrix>');
      expect(page.querySelector("[role=alert]")?.textContent).toBe("page.html is not a CRediT Matrix export.");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refuses a body over the import size cap, by its header or its length", async () => {
    const big = "x".repeat(MAX_IMPORT_BYTES + 1);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (src: string) =>
        src === "said.json"
          ? new Response(json, { headers: { "content-length": String(MAX_IMPORT_BYTES + 1) } })
          : new Response(big),
      ),
    );
    try {
      for (const src of ["said.json", "big.json"]) {
        const root = await mount(`<credit-matrix src="${src}"></credit-matrix>`);
        expect(root.querySelector("[role=alert]")?.textContent).toBe(`Could not load ${src}: it is larger than 1 MB.`);
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows a loading line while src is fetched", async () => {
    let answer: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            answer = resolve;
          }),
      ),
    );
    try {
      document.body.innerHTML = '<credit-matrix src="slow.json"></credit-matrix>';
      const root = document.querySelector("credit-matrix")?.shadowRoot as ShadowRoot;
      expect(root.querySelector("p")?.textContent).toBe("Loading contributions…");
      answer(new Response(json));
      await vi.waitFor(() => expect(root.querySelector("svg")).not.toBeNull());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("puts the alert's text in before the alert enters the page", async () => {
    const element = document.createElement("credit-matrix");
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((batch) => records.push(...batch));
    observer.observe(element.shadowRoot as ShadowRoot, { childList: true, characterData: true, subtree: true });
    document.body.append(element);
    await vi.waitFor(() => expect(element.shadowRoot?.querySelector("[role=alert]")).not.toBeNull());
    observer.disconnect();
    // A screen reader announces an alert when it appears; text filled in afterwards may never be read.
    const alert = element.shadowRoot?.querySelector("[role=alert]");
    expect(records.filter((r) => r.target === alert || r.target.parentNode === alert)).toEqual([]);
    expect(alert?.textContent).toBe("The JSON in this element is not a CRediT Matrix export.");
  });

  it("renders inline JSON added after the element connected", async () => {
    const element = document.createElement("credit-matrix");
    document.body.append(element);
    await vi.waitFor(() => expect(element.shadowRoot?.querySelector("[role=alert]")).not.toBeNull());
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = json;
    element.append(script);
    await vi.waitFor(() => expect(element.shadowRoot?.querySelector("svg")).not.toBeNull());
    expect(element.shadowRoot?.querySelector("[role=alert]")).toBeNull();
  });

  it("follows the locale attribute, else the nearest lang, and marks the figure's language", async () => {
    const inline = `<script type="application/json">${json}</script>`;
    const byAttribute = await mount(`<credit-matrix locale="de">${inline}</credit-matrix>`);
    expect(byAttribute.querySelector("figure")?.lang).toBe("de");
    expect(byAttribute.querySelector("figure > p")?.textContent).toBe(
      "CRediT: Untersuchung: Bob <White>; Software: Jane Smith",
    );
    expect(byAttribute.querySelector("svg title")?.textContent).toBe("Beitragsheatmap");

    const byLang = await mount(`<div lang="de-DE"><credit-matrix>${inline}</credit-matrix></div>`);
    expect(byLang.querySelector("figure")?.lang).toBe("de");

    const unknown = await mount(`<div lang="tlh"><credit-matrix>${inline}</credit-matrix></div>`);
    expect(unknown.querySelector("figure")?.lang).toBe("en");
  });

  it("gives screen readers a table of contributor, role and level, and hides the drawing", async () => {
    const leveled = toJson([
      createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] }),
      createAuthor("Bob White", { contributions: [{ role: "Software", score: 33 }] }),
    ]);
    const root = await mount(`<credit-matrix><script type="application/json">${leveled}</script></credit-matrix>`);
    expect(root.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    const table = root.querySelector("table") as HTMLTableElement;
    expect(table.caption?.textContent).toBe("Contribution heatmap");
    const rows = [...table.rows].map((row) => [...row.cells].map((cell) => cell.textContent));
    expect(rows).toEqual([
      ["", "Jane Smith", "Bob White"],
      ["Software", "Lead", "Supporting"],
    ]);
  });

  it("can be loaded twice without redefining the element", async () => {
    vi.resetModules();
    await expect(import("../element")).resolves.toBeDefined();
  });
});
