import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAuthor } from "@/core";
import { useAskSummary, useContributionStore } from "./contribution-store";

vi.mock("@/lib/announce", () => ({ requestStorageFullAnnouncement: vi.fn() }));
vi.mock("@/lib/reload-for-new-build", () => ({ reloadForNewerSave: vi.fn(() => true) }));

const initial = useContributionStore.getState();
const store = () => useContributionStore.getState();

describe("workspace view state", () => {
  beforeEach(() => useContributionStore.setState(initial, true));

  it("keeps the inspector tab, review highlight, settled cells and self marker", () => {
    store().setInspectorTab("team");
    expect(store().inspectorTab).toBe("team");

    store().setReviewHighlight({ contributorId: "a1", target: "Software" });
    expect(store().reviewHighlight).toEqual({ contributorId: "a1", target: "Software" });

    store().setReviewSettled({ contributorId: "a1", targets: ["Software"] });
    expect(store().reviewSettled).toEqual({ contributorId: "a1", targets: ["Software"] });

    store().setSelfId("a1");
    expect(store().selfId).toBe("a1");
  });

  it("opens the Review tab on one contributor", () => {
    store().openReview("a1");
    expect(store().inspectorTab).toBe("review");
    expect(store().reviewFocus).toBe("a1");
  });

  it("lands on the most recently touched survivor when the open draft is deleted", () => {
    const first = store().activeDraftId;
    const second = store().createDraft();
    const third = store().createDraft();
    if (!second || !third) throw new Error("expected new drafts");
    // Touch the first draft last, so it is the survivor to land on.
    store().switchDraft(first);
    store().setTitle("Touched last");
    store().switchDraft(third);

    store().deleteDraft(third);
    expect(store().activeDraftId).toBe(first);
    expect(store().drafts[second]).toBeDefined();
  });

  it("counts answers and open differences for the hook", () => {
    const { result: summary } = renderHook(() => useAskSummary());
    expect(summary.current).toEqual({ total: 0, answered: 0, open: 0 });

    act(() => store().loadAuthors([createAuthor("Jane Smith"), createAuthor("Bob White")]));
    expect(summary.current.total).toBe(2);
  });
});
