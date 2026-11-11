import { expect, it, vi } from "vitest";
import { DEFAULT_HEATMAP_SETTINGS } from "@/lib/heatmap-settings";
import { reloadForNewerSave } from "@/lib/reload-for-new-build";
import { ensureHydrated, useContributionStore } from "./contribution-store";
import { PERSIST_KEY } from "./persist-meta";

// Version 4 writers must yield before repairing figure settings they cannot retain.
vi.mock("./persist-meta", async (original) => ({
  ...(await original<typeof import("./persist-meta")>()),
  PERSIST_VERSION: 4,
}));
vi.mock("@/lib/reload-for-new-build", () => ({ reloadForNewerSave: vi.fn(() => true) }));

it("keeps a version 4 tab from overwriting the saved figure settings", async () => {
  const { PERSIST_VERSION } = await vi.importActual<typeof import("./persist-meta")>("./persist-meta");
  await ensureHydrated();
  const state = useContributionStore.getState();
  const saved = useContributionStore.persist.getOptions().partialize?.(state);
  if (!saved) throw new Error("Missing persisted draft");
  const draft = saved.drafts[state.activeDraftId];
  const newerSave = JSON.stringify({
    state: {
      ...saved,
      drafts: {
        [state.activeDraftId]: {
          ...draft,
          heatmapSettings: { ...DEFAULT_HEATMAP_SETTINGS, legend: false },
        },
      },
    },
    version: PERSIST_VERSION,
  });
  globalThis.localStorage.setItem(PERSIST_KEY, newerSave);

  state.setTitle("Edited in the older tab");

  expect(globalThis.localStorage.getItem(PERSIST_KEY)).toBe(newerSave);
  expect(reloadForNewerSave).toHaveBeenCalledOnce();
});
