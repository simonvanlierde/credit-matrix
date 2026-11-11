import { DEFAULT_MONO_COLOR, HEX_COLOR } from "../core/contributor-color";
import { PERSIST_KEY, PERSIST_VERSION } from "../store/persist-meta";
import { applyThemeColors } from "./theme-color";

// Runs in the head: the main app intentionally waits until after first paint.
try {
  const saved = JSON.parse(localStorage.getItem(PERSIST_KEY) ?? "null");
  if (saved && !(saved.version > PERSIST_VERSION)) {
    const state = saved.state;
    const draft = state?.drafts?.[state.activeDraftId] ?? state;
    const hue = draft?.heatmapMonoColor;
    if (typeof hue === "string" && HEX_COLOR.test(hue)) {
      const perPerson =
        typeof draft.colorByContributor === "boolean" ? draft.colorByContributor : hue === DEFAULT_MONO_COLOR;
      const people = perPerson && Array.isArray(draft.authors) ? draft.authors.length : null;
      const theme = localStorage.getItem("theme");
      const dark =
        theme === "dark" || ((!theme || theme === "system") && matchMedia("(prefers-color-scheme: dark)").matches);
      applyThemeColors(document.documentElement.style, hue, dark, people);
    }
  }
} catch {
  // Blocked or damaged storage leaves the readable CSS defaults in place.
}
