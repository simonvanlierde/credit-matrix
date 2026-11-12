import { beforeEach, expect, it } from "vitest";
import { createAuthor } from "@/core";
import { followOtherTab, useContributionStore } from "./contribution-store";
import { PERSIST_KEY } from "./persist-meta";

const initial = useContributionStore.getState();
const store = () => useContributionStore.getState();
beforeEach(() => useContributionStore.setState(initial, true));

it("remembers a browser default while each draft keeps its own toolchain", () => {
  store().setToolchain("quarto");
  const first = store().activeDraftId;
  store().createDraft();
  expect(store().toolchain).toBe("quarto");
  store().setToolchain("typst");
  const second = store().activeDraftId;
  store().switchDraft(first);
  expect(store().toolchain).toBe("quarto");
  store().switchDraft(second);
  expect(store().toolchain).toBe("typst");
  store().createDraft();
  expect(store().toolchain).toBe("typst");
});

it("hydrates draft first, browser second, then no choice, and repairs invalid values", () => {
  const { merge } = useContributionStore.persist.getOptions();
  for (const toolchain of [undefined, "invalid", null, "word"]) {
    const restored = merge?.(
      { drafts: { paper: { toolchain } }, activeDraftId: "paper", lastToolchain: "quarto" },
      initial,
    ) as typeof initial;
    expect(restored.toolchain).toBe(toolchain === "word" ? "word" : "quarto");
  }
  const restored = merge?.(
    { drafts: { paper: { toolchain: "invalid" } }, activeDraftId: "paper", lastToolchain: "invalid" },
    initial,
  ) as typeof initial;
  expect(restored.toolchain).toBeUndefined();
});

it("persists the draft and browser default separately and keeps the preference on reset", () => {
  store().setToolchain("latex");
  const { merge, partialize } = useContributionStore.persist.getOptions();
  const restored = merge?.(JSON.parse(JSON.stringify(partialize?.(store()))), initial) as typeof initial;
  expect(restored.toolchain).toBe("latex");
  expect(restored.lastToolchain).toBe("latex");
  store().reset();
  expect(store().toolchain).toBe("latex");
  store().setToolchain(undefined);
  store().createDraft();
  expect(store().toolchain).toBeUndefined();
});

it("saves the browser default through the real localStorage adapter", async () => {
  await useContributionStore.persist.rehydrate();
  store().setToolchain("myst");
  const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? "null");
  expect(saved.state.lastToolchain).toBe("myst");
  const savedText = JSON.stringify(saved);
  useContributionStore.setState(initial, true);
  localStorage.setItem(PERSIST_KEY, savedText);
  await useContributionStore.persist.rehydrate();
  expect(store().lastToolchain).toBe("myst");
  store().createDraft();
  expect(store().toolchain).toBe("myst");
});

it("adopts a cleared toolchain and browser default from another tab", async () => {
  await useContributionStore.persist.rehydrate();
  store().setToolchain("quarto");
  const stale = store();
  store().setToolchain(undefined);
  const cleared = localStorage.getItem(PERSIST_KEY) ?? "null";
  useContributionStore.setState(stale, true);
  localStorage.setItem(PERSIST_KEY, cleared);

  expect(followOtherTab(new StorageEvent("storage", { key: PERSIST_KEY, storageArea: localStorage }))).toBe(true);
  expect(store().toolchain).toBeUndefined();
  expect(store().lastToolchain).toBeUndefined();
});

it("adopts another tab's browser default while a different draft is open here", async () => {
  await useContributionStore.persist.rehydrate();
  const here = store().activeDraftId;
  store().createDraft();
  const there = store().activeDraftId;
  store().switchDraft(here);
  const stale = store();
  store().switchDraft(there);
  store().setToolchain("sphinx");
  const saved = localStorage.getItem(PERSIST_KEY) ?? "null";
  useContributionStore.setState(stale, true);
  localStorage.setItem(PERSIST_KEY, saved);

  expect(followOtherTab(new StorageEvent("storage", { key: PERSIST_KEY, storageArea: localStorage }))).toBe(false);
  expect(store().activeDraftId).toBe(here);
  expect(store().lastToolchain).toBe("sphinx");
});

it("loads a version 5 blob, saved before toolchains existed, with no toolchain chosen", async () => {
  store().loadAuthors([createAuthor("Ada Lovelace")]);
  store().setTitle("Engines");
  const { partialize } = useContributionStore.persist.getOptions();
  const state = JSON.parse(JSON.stringify(partialize?.(store()))) as Record<string, unknown> & {
    drafts: Record<string, Record<string, unknown>>;
  };
  delete state.lastToolchain;
  for (const draft of Object.values(state.drafts)) delete draft.toolchain;
  useContributionStore.setState(initial, true);
  localStorage.setItem(PERSIST_KEY, JSON.stringify({ state, version: 5 }));
  await useContributionStore.persist.rehydrate();
  expect(Object.keys(store().drafts)).toHaveLength(1);
  expect(store().authors.map((a) => a.name)).toEqual(["Ada Lovelace"]);
  expect(store().title).toBe("Engines");
  expect(store().toolchain).toBeUndefined();
  expect(store().lastToolchain).toBeUndefined();
});
