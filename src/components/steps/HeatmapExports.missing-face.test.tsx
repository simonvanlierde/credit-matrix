import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { HeatmapExports } from "./HeatmapExports";

vi.mock("@/lib/announce", () => ({ announce: vi.fn() }));
// Every face loads from disk except Georgian, as if that one download failed offline.
vi.mock("credit-matrix-fonts", async () => {
  // biome-ignore lint/correctness/noNodejsModules: the test runs in Node and reads the font files from disk.
  const { readFile } = await import("node:fs/promises");
  const { FIGURE_FONT_FILES } = await import("@/core/figure-fonts");
  return {
    fonts: async (face: keyof typeof FIGURE_FONT_FILES) => {
      if (face === "sans-georgian") throw new Error("Failed to fetch");
      return new Uint8Array(await readFile(`${import.meta.dirname}/../../fonts/${FIGURE_FONT_FILES[face].file}`));
    },
  };
});

const scored = (name: string) => {
  const author = createAuthor(name);
  for (const contribution of author.contributions) contribution.score = 100;
  return author;
};

it("offers PDF again once the name that needed the missing face is gone", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  const view = (authors: ReturnType<typeof scored>[]) => (
    <IntlProvider locale="en" messages={en}>
      <HeatmapExports authors={authors} showLevels={false} />
    </IntlProvider>
  );
  const { rerender } = render(view([scored("Ada Lovelace"), scored("ნინო")]));
  fireEvent.click(screen.getByRole("button", { name: /Heatmap/ }));
  const pdf = () => screen.getByRole<HTMLButtonElement>("button", { name: "Download PDF" });
  await screen.findByText(/The figure fonts could not be loaded/, {}, { timeout: 15_000 });
  expect(pdf().disabled).toBe(true);

  rerender(view([scored("Ada Lovelace")]));
  await waitFor(() => expect(pdf().disabled).toBe(false), { timeout: 15_000 });
  expect(screen.queryByText(/The figure fonts could not be loaded/)).toBeNull();
}, 30_000);
