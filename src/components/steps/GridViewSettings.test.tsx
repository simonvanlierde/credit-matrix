import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { ContributionGrid } from "./ContributionGrid";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));

const author = createAuthor("Jane Smith", { contributions: [{ role: "Software", score: 100 }] });
const state = () => useContributionStore.getState();
const PALE = "Supporting is hard to distinguish in this color. Try a darker shade.";

beforeEach(() => {
  state().reset();
  act(() => state().loadAuthors([author]));
});

function renderBoth() {
  return render(
    <IntlProvider locale="en" messages={en}>
      <ContributionGrid />
    </IntlProvider>,
  );
}

describe("GridViewSettings", () => {
  it("edits the grid's view from Figure settings, and the grid popover shows the same state", () => {
    renderBoth();
    fireEvent.click(screen.getByRole("button", { name: /^Heatmap$/ }));
    fireEvent.click(screen.getByRole("button", { name: "Figure settings" }));
    const panel = screen.getByRole("region", { name: "Figure settings" });
    fireEvent.click(within(panel).getByRole("radio", { name: "Contributors in rows" }));
    fireEvent.click(within(panel).getByRole("switch", { name: /Use initials/ }));
    expect(state().transpose).toBe(true);
    expect(state().initials).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Heatmap options" }));
    const options = screen.getAllByRole("radio", { name: "Contributors in rows" });
    expect(options.every((o) => o.getAttribute("aria-checked") === "true")).toBe(true);
    expect(
      screen.getAllByRole("switch", { name: /Use initials/ }).every((s) => s.getAttribute("aria-checked") === "true"),
    ).toBe(true);
  });

  it("warns about a very pale custom colour, except when colouring per contributor", () => {
    act(() => {
      state().setHeatmapMonoColor("#f4f4f4");
      state().setColorByContributor(false);
    });
    renderBoth();
    fireEvent.click(screen.getByRole("button", { name: "Heatmap options" }));
    expect(screen.getByText(PALE)).toBeTruthy();
    act(() => state().setColorByContributor(true));
    expect(screen.queryByText(PALE)).toBeNull();
  });
});
