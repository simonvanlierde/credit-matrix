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
});
