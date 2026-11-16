import { DEFAULT_MONO_COLOR, HEX_COLOR } from "../core/contributor-color";
import { PERSIST_KEY, PERSIST_VERSION } from "../store/persist-meta";
import { applyThemeColors } from "./theme-color";

// Runs in the head: the main app intentionally waits until after first paint.
const isDark = () => {
  const theme = localStorage.getItem("theme");
  return theme === "dark" || ((!theme || theme === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
};

try {
  const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? "null");
  // A first visit gets what a new draft paints (default hue, colour by contributor), so the store's
  // first update after load changes nothing on screen, in dark mode too.
  if (saved === null) applyThemeColors(document.documentElement.style, DEFAULT_MONO_COLOR, isDark(), 0);
  if (saved && !(saved.version > PERSIST_VERSION)) {
    const state = saved.state;
    const draft = state?.drafts?.[state.activeDraftId] ?? state;
    const hue = draft?.heatmapMonoColor;
    if (typeof hue === "string" && HEX_COLOR.test(hue)) {
      const perPerson =
        typeof draft.colorByContributor === "boolean" ? draft.colorByContributor : hue === DEFAULT_MONO_COLOR;
      const people = perPerson && Array.isArray(draft.authors) ? draft.authors.length : null;
      applyThemeColors(document.documentElement.style, hue, isDark(), people);
    }
  }
} catch {
  // Blocked or damaged storage leaves the readable CSS defaults in place.
}
