import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { HeatmapExports } from "./HeatmapExports";

const svg = vi.hoisted(() =>
  vi.fn(
    async () => '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text font-size="4">a</text></svg>',
  ),
);
vi.mock("@/core/figures", () => ({ createFigureRenderer: () => ({ svg }) }));
vi.mock("credit-matrix-fonts", () => ({ fonts: async () => new Uint8Array() }));
vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  svg.mockClear();
  useContributionStore.getState().reset();
});
afterEach(() => vi.useRealTimers());

it("renders the preview once after rapid option changes", async () => {
  const authors = [createAuthor("Grace Hopper", { contributions: [{ role: "Software", score: 100 }] })];
  render(
    <IntlProvider locale="en" messages={en}>
      <HeatmapExports authors={authors} showLevels={false} />
    </IntlProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Heatmap/ }));
  for (const color of ["#21763c", "#1f4e79", "#8b2d2d"]) {
    act(() => useContributionStore.getState().setHeatmapMonoColor(color));
    await act(() => vi.advanceTimersByTimeAsync(50));
  }
  expect(svg).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(250));
  expect(svg).toHaveBeenCalledTimes(1);
});
