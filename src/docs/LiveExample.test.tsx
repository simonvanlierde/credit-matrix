import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { IntlProvider } from "@/lib/translations";
import { useHydrated } from "@/lib/use-hydrated";
import { messages as de } from "@/locales/de/messages";
import { messages as en } from "@/locales/en/messages";
import { useContributionStore } from "@/store/contribution-store";
import { useGuide } from "@/store/guide-store";
import LiveExample from "./LiveExample";
import type { LiveTarget } from "./live-markers";

vi.mock("@/lib/use-hydrated", () => ({ useHydrated: vi.fn(() => true) }));
const initial = useContributionStore.getState();
const draftAuthors = [createAuthor("Morgan Example", { contributions: [{ role: "Software", score: 100 }] })];

beforeEach(() => {
  useContributionStore.setState(initial, true);
  vi.mocked(useHydrated).mockReturnValue(true);
});

function example(target: LiveTarget = "typst") {
  return (
    <IntlProvider locale="en" messages={en}>
      <LiveExample target={target} />
    </IntlProvider>
  );
}

it("shows one export without repeating installation, recipes or a link to the current guide", () => {
  render(example("quarto"));
  expect(screen.getAllByRole("textbox")).toHaveLength(1);
  expect(screen.queryByRole("link", { name: /Set up Quarto/ })).toBeNull();
  expect(screen.queryByText("CLI equivalent")).toBeNull();
});

it("without a draft, points to the app where the reader's own contributors come from", () => {
  render(example());
  expect(screen.getByText("Sample contributors")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Add your own contributors in the app" }).getAttribute("href")).toBe("/");
  expect(screen.queryByRole("button", { name: "Use your draft" })).toBeNull();
  act(() => useContributionStore.getState().loadAuthors(draftAuthors));
  expect(screen.queryByRole("link", { name: "Add your own contributors in the app" })).toBeNull();
  expect(screen.getByRole("button", { name: "Use sample contributors" })).toBeTruthy();
});

it("shows the current draft first and switches sources without changing the draft or getting started guide", () => {
  act(() => useContributionStore.getState().loadAuthors(draftAuthors));
  const before = useContributionStore.getState();
  const guide = useGuide.getState();
  render(example());
  const output = () => (screen.getByRole("textbox", { name: /JSON$/ }) as HTMLTextAreaElement).value;
  expect(screen.getByText("Using your draft in this browser")).toBeTruthy();
  // The textarea is named by the visible source and format, so a screen reader hears which data it holds.
  expect(screen.getByRole("textbox", { name: "Using your draft in this browser JSON" })).toBeTruthy();
  expect(output()).toContain("Morgan Example");
  fireEvent.click(screen.getByRole("button", { name: "Use sample contributors" }));
  expect(screen.getByText("Sample contributors")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "Sample contributors JSON" })).toBeTruthy();
  expect(output()).not.toContain("Morgan Example");
  const sample = output();
  fireEvent.click(screen.getByRole("button", { name: "Use your draft" }));
  expect(output()).toContain("Morgan Example");
  fireEvent.click(screen.getByRole("button", { name: "Use sample contributors" }));
  expect(output()).toBe(sample);
  expect(useContributionStore.getState()).toBe(before);
  expect(useGuide.getState()).toBe(guide);
  expect([...screen.getAllByRole("textbox")].every((box) => (box as HTMLTextAreaElement).readOnly)).toBe(true);
});

it("shows stable sample data with an empty draft", () => {
  const view = render(example());
  expect(screen.getByText("Sample contributors")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use your draft" })).toBeNull();
  const output = (screen.getByRole("textbox", { name: /JSON$/ }) as HTMLTextAreaElement).value;
  view.rerender(example());
  expect((screen.getByRole("textbox", { name: /JSON$/ }) as HTMLTextAreaElement).value).toBe(output);
  expect(useContributionStore.getState().authors).toEqual([]);
});

it("uses the current draft without claiming it was saved when storage fails", () => {
  act(() => useContributionStore.setState({ authors: draftAuthors, saveFailure: "full" }));
  render(example());
  expect(screen.getByText("Using your draft in this browser")).toBeTruthy();
  expect((screen.getByRole("textbox", { name: /JSON$/ }) as HTMLTextAreaElement).value).toContain("Morgan Example");
  expect(screen.queryByText(/saved/i)).toBeNull();
});

it("waits for hydration before showing saved or sample data", () => {
  vi.mocked(useHydrated).mockReturnValue(false);
  const view = render(example());
  expect(screen.getByRole("status").textContent).toBe("Loading example…");
  expect(screen.queryByRole("textbox")).toBeNull();
  vi.mocked(useHydrated).mockReturnValue(true);
  view.rerender(example());
  expect(screen.getByText("Sample contributors")).toBeTruthy();
});

it("leaves ask history, sign-in identity and the saved writing tool out of documentation JSON", () => {
  const id = draftAuthors[0]?.id;
  if (!id) throw new Error("expected a contributor");
  act(() =>
    useContributionStore.setState({
      authors: draftAuthors,
      asks: { [id]: { sentAt: 1, prefilled: true } },
      selfId: id,
      toolchain: "sphinx",
    }),
  );
  render(example());
  const output = JSON.parse((screen.getByRole("textbox", { name: /JSON$/ }) as HTMLTextAreaElement).value);
  expect(output.authors).toEqual(draftAuthors);
  expect(output.asks).toBeUndefined();
  expect(output.selfId).toBeUndefined();
  expect(output.toolchain).toBeUndefined();
});

it("keeps source choices local to each example", () => {
  act(() => useContributionStore.setState({ authors: draftAuthors }));
  render(
    <IntlProvider locale="en" messages={en}>
      <LiveExample target="typst" />
      <LiveExample target="typst" />
    </IntlProvider>,
  );
  const examples = screen.getAllByRole("region", { name: "Example" });
  const first = examples[0];
  const second = examples[1];
  if (!first || !second) throw new Error("expected two examples");
  fireEvent.click(within(first).getByRole("button", { name: "Use sample contributors" }));
  expect(within(second).getByText("Using your draft in this browser")).toBeTruthy();
});

it("renders the RO-Crate fragment without a writing-tool recipe", () => {
  render(example("ro-crate"));
  const output = screen.getByRole("textbox", { name: /RO-Crate fragment$/ }) as HTMLTextAreaElement;
  expect(JSON.parse(output.value)["@graph"]).toBeTruthy();
  expect(screen.queryByRole("textbox", { name: "CLI equivalent" })).toBeNull();
});

it("marks translated controls and generated output with their own languages", async () => {
  act(() => useContributionStore.setState({ uiLocale: "de", outputLocale: "nl" }));
  render(
    <IntlProvider locale="de" messages={de}>
      <LiveExample target="typst" />
    </IntlProvider>,
  );
  const region = screen.getByRole("region", { name: "Beispiel" });
  expect(region.getAttribute("lang")).toBe("de");
  await waitFor(() => expect(screen.getByRole("textbox", { name: /JSON$/ }).getAttribute("lang")).toBe("nl"));
  const output = screen.getByRole("textbox", { name: /JSON$/ }) as HTMLTextAreaElement;
  expect(output.value).toContain("Marie Curie");
});
