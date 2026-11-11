import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { download } from "@/lib/utils";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ContributionGrid } from "./ContributionGrid";
import { HeatmapExports } from "./HeatmapExports";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
// jsdom has no server for the fonts' asset URLs; read the package's own copies from disk.
vi.mock("credit-matrix-fonts", async () => {
  // biome-ignore lint/correctness/noNodejsModules: the test runs in Node and reads the font files from disk.
  const { readFile } = await import("node:fs/promises");
  const { FIGURE_FONT_FILES } = await import("@/core/figure-fonts");
  return {
    fonts: async (face: keyof typeof FIGURE_FONT_FILES) =>
      new Uint8Array(await readFile(`${import.meta.dirname}/../../fonts/${FIGURE_FONT_FILES[face].file}`)),
  };
});
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  download: vi.fn(),
}));

describe("HeatmapExports", () => {
  beforeEach(() => useContributionStore.getState().reset());

  it("previews and exports SVG and PNG for a Tibetan name, and refuses only PDF", async () => {
    const author = createAuthor("བོད་ཡིག");
    for (const contribution of author.contributions) contribution.score = 100;
    render(
      <IntlProvider locale="en" messages={en}>
        <HeatmapExports authors={[author]} showLevels={false} />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Heatmap/ }));

    // Real font files: the preview loads every face before falling back.
    const preview = await screen.findByRole("img", {}, { timeout: 15_000 });
    expect(decodeURIComponent(preview.getAttribute("src") ?? "")).toContain("བོད་ཡིག");
    expect(screen.getByRole("status").textContent).toMatch(
      /cannot display these characters: བོད་ཡིག\..*SVG and PNG draw them with the installed fonts/,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const menuButton = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });
    expect(menuButton("Download PDF").disabled).toBe(true);
    expect(menuButton("Download PNG").disabled).toBe(false);
    expect(menuButton("Copy PNG").disabled).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Download SVG" }));
    await waitFor(() => expect(download).toHaveBeenCalledOnce());
    const [blob, filename] = vi.mocked(download).mock.calls[0] ?? [];
    expect(filename).toBe("credit-heatmap.svg");
    expect(await (blob as Blob).text()).toMatch(/<tspan font-family="'IBM Plex Sans'[^"]*">བོད་ཡིག<\/tspan>/);
    expect(screen.queryByRole("alert")).toBeNull();
  }, 30_000);

  it("draws the figure in the hue picked in the grid's popover, and says when it is per contributor", async () => {
    const author = createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] });
    act(() => useContributionStore.getState().loadAuthors([author]));
    render(
      <IntlProvider locale="en" messages={en}>
        <ContributionGrid />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Heatmap options" }));
    fireEvent.click(screen.getByRole("button", { name: "Green" }));
    expect(screen.getByRole("button", { name: "Green" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: /^Heatmap$/ }));
    const preview = await within(await screen.findByRole("region", { name: "Contribution heatmap" })).findByRole(
      "img",
      {},
      { timeout: 15_000 },
    );
    expect(decodeURIComponent(preview.getAttribute("src") ?? "")).toContain("#21763c");
    expect(screen.queryByText(/Colored per contributor/)).toBeNull();

    // Figure settings edit the same value, under a heading that says it is shared.
    fireEvent.click(screen.getByRole("button", { name: "Figure settings" }));
    expect(screen.getByRole("group", { name: "Shared with the grid" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Per contributor" }));
    expect(useContributionStore.getState().colorByContributor).toBe(true);
    expect(await screen.findByText(/Colored per contributor/)).toBeTruthy();
  }, 30_000);

  it("Reset restores the figure's own options and leaves the shared ones", () => {
    const author = createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] });
    act(() => {
      const store = useContributionStore.getState();
      store.loadAuthors([author]);
      store.setHeatmapMonoColor("#21763c");
      store.setTranspose(true);
      store.setInitials(true);
      store.setColorByContributor(false);
    });
    render(
      <IntlProvider locale="en" messages={en}>
        <HeatmapExports authors={[author]} showLevels={false} />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Heatmap$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Figure settings" }));
    const panel = screen.getByRole("region", { name: "Figure settings" });
    // A figure-only option: switch to short labels, then check Reset brings the full ones back.
    const pressed = (name: string) => within(panel).getByRole("radio", { name }).getAttribute("aria-checked");
    fireEvent.click(within(panel).getByRole("radio", { name: "Short labels" }));
    expect(pressed("Short labels")).toBe("true");
    fireEvent.click(within(panel).getByRole("button", { name: "Reset" }));
    expect(pressed("Full labels")).toBe("true");
    const state = useContributionStore.getState();
    expect([state.heatmapMonoColor, state.transpose, state.initials, state.colorByContributor]).toEqual([
      "#21763c",
      true,
      true,
      false,
    ]);
  });
});
