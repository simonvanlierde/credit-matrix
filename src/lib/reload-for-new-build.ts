const KEY = "credit-matrix:reloaded-for-new-build";
const WINDOW_MS = 60_000;

/**
 * Reload once when a lazy chunk (a locale catalog) fails to load. After a
 * deploy an open tab still names the previous build's files, which are gone;
 * a reload picks up the new build, and every edit is already saved. Returns
 * whether it reloaded. Offline, or a second failure within the window, is a
 * real outage: the caller falls back to English instead of looping.
 */
export function reloadForNewBuild(): boolean {
  if (!navigator.onLine) return false;
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No sessionStorage means no loop guard: do not risk a reload loop.
    return false;
  }
  window.location.reload();
  return true;
}
