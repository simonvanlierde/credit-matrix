import { renderHook } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { useContributionStore } from "@/store/contribution-store";
import { useClaimLock } from "./use-claim-lock";

const initial = useContributionStore.getState();

beforeEach(() => {
  useContributionStore.setState(initial, true);
});

describe("useClaimLock", () => {
  it("names the one row a claim leaves editable, so the interface can look locked too", () => {
    const { result } = renderHook(() => useClaimLock());
    expect(result.current).toEqual({ locked: false, editableAuthorId: null });

    act(() => useContributionStore.getState().setClaim({ contributorId: "grace", sourceDraftId: "src-1" }));
    expect(result.current).toEqual({ locked: true, editableAuthorId: "grace" });
  });
});
