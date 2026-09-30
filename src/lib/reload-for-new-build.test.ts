import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reloadForNewBuild } from "./reload-for-new-build";

describe("reloadForNewBuild", () => {
  const reload = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal("location", { ...window.location, reload });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    reload.mockReset();
  });

  it("reloads once, then leaves a repeat failure to the fallback", () => {
    expect(reloadForNewBuild()).toBe(true);
    expect(reloadForNewBuild()).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("reloads again once the window has passed", () => {
    sessionStorage.setItem("credit-matrix:reloaded-for-new-build", String(Date.now() - 61_000));
    expect(reloadForNewBuild()).toBe(true);
  });

  it("does not reload offline, where a reload cannot fetch the new build", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(reloadForNewBuild()).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });
});
