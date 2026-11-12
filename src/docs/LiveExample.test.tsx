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

it("shows the current draft first and switches sources without changing the draft or getting started guide", () => {
  act(() => useContributionStore.getState().loadAuthors(draftAuthors));
  const before = useContributionStore.getState();
  const guide = useGuide.getState();
  render(example());
  const output = () => (screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value;
  expect(screen.getByText("Showing your draft")).toBeTruthy();
  expect(output()).toContain("Morgan Example");
  fireEvent.click(screen.getByRole("button", { name: "Use sample data" }));
  expect(screen.getByText("Showing sample data")).toBeTruthy();
  expect(output()).not.toContain("Morgan Example");
  const sample = output();
  fireEvent.click(screen.getByRole("button", { name: "Use your draft" }));
  expect(output()).toContain("Morgan Example");
  fireEvent.click(screen.getByRole("button", { name: "Use sample data" }));
  expect(output()).toBe(sample);
  expect(useContributionStore.getState()).toBe(before);
  expect(useGuide.getState()).toBe(guide);
  expect([...screen.getAllByRole("textbox")].every((box) => (box as HTMLTextAreaElement).readOnly)).toBe(true);
});

it("shows stable sample data with an empty draft", () => {
  const view = render(example());
  expect(screen.getByText("Showing sample data")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Use your draft" })).toBeNull();
  const output = (screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value;
  view.rerender(example());
  expect((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value).toBe(output);
  expect(useContributionStore.getState().authors).toEqual([]);
});

it("waits for hydration before showing saved or sample data", () => {
  vi.mocked(useHydrated).mockReturnValue(false);
  const view = render(example());
  expect(screen.getByRole("status").textContent).toBe("Loading your draft…");
  expect(screen.queryByRole("textbox")).toBeNull();
  vi.mocked(useHydrated).mockReturnValue(true);
  view.rerender(example());
  expect(screen.getByText("Showing sample data")).toBeTruthy();
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
  const output = JSON.parse((screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement).value);
  expect(output.authors).toEqual(draftAuthors);
  expect(output.asks).toBeUndefined();
  expect(output.selfId).toBeUndefined();
  expect(output.toolchain).toBeUndefined();
});

it("keeps source choices local to each example and recipe anchors unique", () => {
  act(() => useContributionStore.setState({ authors: draftAuthors }));
  const { container } = render(
    <IntlProvider locale="en" messages={en}>
      <LiveExample target="typst" />
      <LiveExample target="typst" />
    </IntlProvider>,
  );
  const examples = screen.getAllByRole("region", { name: "Live example" });
  const first = examples[0];
  const second = examples[1];
  if (!first || !second) throw new Error("expected two examples");
  fireEvent.click(within(first).getByRole("button", { name: "Use sample data" }));
  expect(within(second).getByText("Showing your draft")).toBeTruthy();
  const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids).toHaveLength(2);
});

it("renders the RO-Crate fragment without a writing-tool recipe", () => {
  render(example("ro-crate"));
  const output = screen.getByRole("textbox", { name: "RO-Crate fragment" }) as HTMLTextAreaElement;
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
  const region = screen.getByRole("region", { name: "Live-Beispiel" });
  expect(region.getAttribute("lang")).toBe("de");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "JSON" }).getAttribute("lang")).toBe("nl"));
  const output = screen.getByRole("textbox", { name: "JSON" }) as HTMLTextAreaElement;
  expect(output.value).toContain("Emmy Noether");
});
