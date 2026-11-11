import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { HeatmapExports } from "./HeatmapExports";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
// Offline before the service worker cached the fonts: every face fails to load.
vi.mock("credit-matrix-fonts", () => ({ fonts: () => Promise.reject(new Error("Failed to fetch")) }));

describe("HeatmapExports with the figure fonts unavailable", () => {
  it("says so and refuses PDF, while SVG and PNG use system fonts", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const author = createAuthor("Ada Lovelace");
    for (const contribution of author.contributions) contribution.score = 100;
    render(
      <IntlProvider locale="en" messages={en}>
        <HeatmapExports authors={[author]} showLevels={false} />
      </IntlProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: /Heatmap/ }));

    await screen.findByRole("img", {}, { timeout: 15_000 });
    expect(screen.getByRole("status").textContent).toMatch(
      /The figure fonts could not be loaded\..*SVG and PNG draw them with the installed fonts/,
    );
    expect(screen.queryByRole("alert")).toBeNull();
    const menuButton = (name: string) => screen.getByRole<HTMLButtonElement>("button", { name });
    expect(menuButton("Download PDF").disabled).toBe(true);
    expect(menuButton("Download SVG").disabled).toBe(false);
  }, 30_000);
});
