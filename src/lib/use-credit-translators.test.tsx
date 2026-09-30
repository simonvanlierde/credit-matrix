import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@/core";
import { useContributionStore } from "@/store/contribution-store";
import { reloadForNewBuild } from "./reload-for-new-build";
import { useCreditTranslators } from "./use-credit-translators";

// A real reload is a navigation jsdom cannot perform; the tests decide
// whether it "happened".
vi.mock("./reload-for-new-build", () => ({ reloadForNewBuild: vi.fn(() => false) }));

const initial = useContributionStore.getState();

function setLocales(outputLocale: core.LocaleCode, uiLocale: core.LocaleCode) {
  useContributionStore.setState({ outputLocale, uiLocale });
}

beforeEach(() => {
  useContributionStore.setState(initial, true);
});

describe("useCreditTranslators", () => {
  it("starts on English, so the first paint never shows a half-loaded catalog", () => {
    setLocales("fr", "fr");
    const { result } = renderHook(() => useCreditTranslators());

    expect(result.current.translateRole("Conceptualization")).toBe("Conceptualization");
    expect(result.current.outputLanguage).toBe("en");
  });

  it("follows the output language for role names and the interface one for descriptions", async () => {
    setLocales("fr", "nl");
    const { result } = renderHook(() => useCreditTranslators());

    await waitFor(() => expect(result.current.outputLanguage).toBe("fr"));
    expect(result.current.translateRole("Conceptualization")).toBe("Conceptualisation");
    expect(result.current.interfaceRoleLanguage).toBe("nl");
    // The description is help the reader is reading now, not export text.
    expect(result.current.describeRole("Conceptualization")).toBe(
      (await core.loadRoleCatalog("nl"))?.[core.getRoleByName("Conceptualization").url]?.description,
    );
  });

  it("fetches each catalog once when both languages agree", async () => {
    const loadRoles = vi.spyOn(core, "loadRoleCatalog");
    const loadUi = vi.spyOn(core, "loadUiCatalog");
    setLocales("de", "de");

    const { result } = renderHook(() => useCreditTranslators());
    await waitFor(() => expect(result.current.outputLanguage).toBe("de"));

    expect(loadRoles).toHaveBeenCalledTimes(1);
    expect(loadUi).toHaveBeenCalledTimes(1);
    expect(result.current.translateInterfaceRole("Conceptualization")).toBe(
      result.current.translateRole("Conceptualization"),
    );
  });

  it("falls back to English when a locale chunk fails to load", async () => {
    vi.spyOn(core, "loadRoleCatalog").mockRejectedValue(new Error("chunk load failed"));
    setLocales("ja", "ja");

    const { result } = renderHook(() => useCreditTranslators());

    // The hook starts out English, so wait for the reload attempt first:
    // otherwise this passes before the failure has even been handled.
    await waitFor(() => expect(reloadForNewBuild).toHaveBeenCalled());
    await waitFor(() => expect(result.current.outputLanguage).toBe("en"));
    expect(result.current.translateRole("Conceptualization")).toBe("Conceptualization");
    // Help text falls back to the bundled English catalog, not to a blank panel.
    expect(result.current.describeRole("Conceptualization")).toBe(core.getRoleByName("Conceptualization").description);
    expect(result.current.describeRole("Not A Role")).toBe("");
  });

  it("leaves the state alone when the failure reloads the page", async () => {
    vi.mocked(reloadForNewBuild).mockReturnValueOnce(true);
    vi.spyOn(core, "loadRoleCatalog").mockRejectedValue(new Error("chunk load failed"));
    setLocales("ja", "ja");

    const { result } = renderHook(() => useCreditTranslators());
    const before = result.current;
    await waitFor(() => expect(reloadForNewBuild).toHaveBeenCalled());

    // The page is going away; a state update would only flash English first.
    expect(result.current).toBe(before);
  });

  it("drops a resolved load for a language the reader has already moved off", async () => {
    setLocales("es", "es");
    const { result, unmount } = renderHook(() => useCreditTranslators());
    unmount();

    // The catalog resolves after the unmount; nothing may set state on it.
    await expect(waitFor(() => expect(result.current.outputLanguage).toBe("es"), { timeout: 100 })).rejects.toThrow();
  });
});
