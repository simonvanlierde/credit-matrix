const WINDOW_MS = 60_000;

/**
 * Reload, at most once per window under `key`. Returns whether it reloaded.
 * Offline, a second request within the window, or no sessionStorage to hold
 * the guard all refuse, so a reload that does not fix things cannot loop.
 */
function reloadOnce(key: string): boolean {
  if (!navigator.onLine) return false;
  try {
    if (Date.now() - Number(sessionStorage.getItem(key) ?? 0) < WINDOW_MS) return false;
    sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // No sessionStorage means no loop guard: do not risk a reload loop.
    return false;
  }
  window.location.reload();
  return true;
}

/**
 * Reload once when a lazy chunk (a locale catalog) fails to load. After a
 * deploy an open tab still names the previous build's files, which are gone;
 * a reload picks up the new build, and every edit is already saved. A refusal
 * is a real outage: the caller falls back to English instead of looping.
 */
export function reloadForNewBuild(): boolean {
  return reloadOnce("credit-matrix:reloaded-for-new-build");
}

/**
 * Reload once when a newer build has saved the drafts, so this tab becomes
 * that build. Its own key, so a recent chunk reload does not block this one,
 * nor this one a chunk reload.
 */
export function reloadForNewerSave(): boolean {
  return reloadOnce("credit-matrix:reloaded-for-newer-save");
}
