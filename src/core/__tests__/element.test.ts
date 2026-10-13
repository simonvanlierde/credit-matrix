// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "../element";
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

  it("says so when the data does not load", async () => {
    const root = await mount("<credit-matrix><script type='application/json'>{</script></credit-matrix>");
    expect(root.querySelector("[role=alert]")?.textContent).toBe("Could not load the contributions.");
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
      expect(root.querySelector("[role=alert]")?.textContent).toBe("Could not load the contributions.");
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

  it("can be loaded twice without redefining the element", async () => {
    vi.resetModules();
    await expect(import("../element")).resolves.toBeDefined();
  });
});
