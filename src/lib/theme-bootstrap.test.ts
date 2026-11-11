import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { heatCellColor } from "../core/contributor-color";
import { PERSIST_KEY, PERSIST_VERSION } from "../store/persist-meta";
import { accentFor } from "./theme-color";

const root = document.documentElement;
const savedDraft = (draft: Record<string, unknown>) =>
  JSON.stringify({ version: PERSIST_VERSION, state: { activeDraftId: "active", drafts: { active: draft } } });
const green = { heatmapMonoColor: "#21763c", colorByContributor: false, authors: [] };
const boot = () => import("./theme-bootstrap");

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  root.removeAttribute("style");
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: false })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  root.removeAttribute("style");
});

it.each(["light", "dark", "system"])("restores the active draft and saved %s mode before hydration", async (theme) => {
  const stored = savedDraft(green);
  localStorage.setItem(PERSIST_KEY, stored);
  localStorage.setItem("theme", theme);
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true })),
  );
  await boot();
  const dark = theme !== "light";
  expect(root.style.getPropertyValue("--color-primary")).toBe(accentFor(green.heatmapMonoColor, dark));
  expect(root.style.getPropertyValue("--color-mark-0-100")).toBe(heatCellColor(green.heatmapMonoColor, 100, dark));
  expect(localStorage.getItem(PERSIST_KEY)).toBe(stored);
});

it.each([2, 9])("uses the same contributor palette fallback for %s authors", async (count) => {
  localStorage.setItem(PERSIST_KEY, savedDraft({ ...green, colorByContributor: true, authors: Array(count).fill({}) }));
  await boot();
  expect(root.style.getPropertyValue("--color-primary")).toBe(
    count > 8 ? accentFor(green.heatmapMonoColor, false) : "",
  );
  expect(root.style.getPropertyValue("--color-mark-0-100")).toBe(count > 8 ? green.heatmapMonoColor : "#2a5fa8");
});

it.each([
  null,
  "{broken",
  savedDraft({ ...green, heatmapMonoColor: "red" }),
  JSON.stringify({ version: PERSIST_VERSION + 1, state: green }),
])("leaves defaults intact for absent, malformed or newer storage: %s", async (stored) => {
  if (stored !== null) localStorage.setItem(PERSIST_KEY, stored);
  await boot();
  expect(root.getAttribute("style")).toBeNull();
});

it("leaves defaults intact when storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("blocked");
  });
  await expect(boot()).resolves.toBeDefined();
  expect(root.getAttribute("style")).toBeNull();
});
