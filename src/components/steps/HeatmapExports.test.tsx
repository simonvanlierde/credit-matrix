import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { download } from "@/lib/utils";
import { messages as en } from "@/locales/en/messages";
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
        <HeatmapExports authors={[author]} monoColor="#1f4e79" showLevels={false} transpose={false} acronyms />
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
});
