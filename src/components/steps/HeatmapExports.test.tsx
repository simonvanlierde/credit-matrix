import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { download } from "@/lib/utils";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ContributionGrid } from "./ContributionGrid";
import { HeatmapExports } from "./HeatmapExports";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
// jsdom has no server for the fonts' asset URLs; read the package's own copies from disk.
vi.mock("@/core/figures", async (importOriginal) => {
  const figures = await importOriginal<typeof import("@/core/figures")>();
  const testFile = import.meta.url;
  return {
    ...figures,
    createFigureRenderer: () =>
      figures.createFigureRenderer({ fontFallback: new URL("../../core/figure-fonts/", testFile) }),
  };
});
vi.mock("@/lib/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/utils")>()),
  download: vi.fn(),
}));

describe("HeatmapExports", () => {
  it("previews and exports SVG and PNG for a Hangul name, and refuses only PDF", async () => {
    const author = createAuthor("김민준");
    for (const contribution of author.contributions) contribution.score = 100;
    render(
      <IntlProvider locale="en" messages={en}>
        <HeatmapExports authors={[author]} showLevels={false} />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Heatmap/ }));

    // Real font files: the preview loads every face before falling back.
    const preview = await screen.findByRole("img", {}, { timeout: 15_000 });
    expect(decodeURIComponent(preview.getAttribute("src") ?? "")).toContain("김민준");
    expect(screen.getByRole("status").textContent).toMatch(
      /cannot display these characters: 김민준\..*SVG and PNG draw them with the installed fonts/,
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
    expect(await (blob as Blob).text()).toMatch(/<tspan font-family="'IBM Plex Sans'[^"]*">김민준<\/tspan>/);
    expect(screen.queryByRole("alert")).toBeNull();
  }, 30_000);

  it("draws the figure in the hue picked in the grid's popover, and says when it is per contributor", async () => {
    const author = createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] });
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
    expect(decodeURIComponent(preview.getAttribute("src") ?? "")).toContain("#00724c");
    expect(screen.queryByText(/Colored per contributor/)).toBeNull();

    // The figure settings edit the same value.
    fireEvent.click(screen.getByRole("button", { name: "Figure settings" }));
    fireEvent.click(screen.getByRole("button", { name: "Per contributor" }));
    expect(await screen.findByText(/Colored per contributor/)).toBeTruthy();
  }, 30_000);
});
