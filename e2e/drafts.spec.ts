import { expect, test } from "@playwright/test";
import { PERSIST_KEY, PERSIST_VERSION } from "../src/store/persist-meta";
import { onScreen, seedStorage } from "./helpers";

test("deletes every draft after confirmation, and a reload finds none", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await page.getByLabel("Draft title").fill("Paper one");
  await page.getByLabel("Draft title").press("Enter");
  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await page.getByRole("button", { name: "New draft" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);

  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await page.getByRole("button", { name: "Delete all drafts" }).click();
  await expect(onScreen(page, "Delete every draft in this browser? This cannot be undone.")).toBeVisible();
  // The confirm button's text, not the per-draft trash icons labelled the same.
  await page.getByText("Delete", { exact: true }).click();

  await page.reload();
  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await expect(page.getByRole("button", { name: "Switch to Paper one" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(0);
});

// Two pages in one context share localStorage, and a write in one fires a
// `storage` event in the other, as between two real tabs.
test("follows another tab's edit of the open draft and says so", async ({ page, context }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);

  const other = await context.newPage();
  await other.goto("/");
  await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await other
    .getByRole("button", { name: /^Remove / })
    .first()
    .click();
  await expect(other.getByRole("button", { name: /^Remove / })).toHaveCount(2);

  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(2);
  await expect(onScreen(page, "This draft was updated in another tab.")).toBeVisible();
});

// The refusal is found during the restore, before the status strip has
// mounted: it must still be shown.
test("says at load that edits are not saved when it cannot reload into a newer build", async ({ page }) => {
  await page.addInitScript(
    ({ key, version }) => {
      window.localStorage.setItem(key, JSON.stringify({ state: { drafts: {}, activeDraftId: "a" }, version }));
      // A reload just happened, so the loop guard refuses another.
      window.sessionStorage.setItem("credit-matrix:reloaded-for-newer-save", String(Date.now()));
    },
    { key: PERSIST_KEY, version: PERSIST_VERSION + 1 },
  );
  await page.goto("/");
  await expect(onScreen(page, /A newer version of CRediT Matrix saved your drafts/)).toBeVisible();
});

// Each tab holds a copy of the drafts it has parked. A tab that loaded first
// must not save its copy over a parked draft another tab edited since, nor
// open that old copy later.
test("keeps another tab's edit of a draft parked here", async ({ page, context }) => {
  const draft = (id: string, title: string) => ({ id, title, authors: [], updatedAt: 1 });
  const seed = {
    drafts: { x: draft("x", "Paper X"), y: draft("y", "Paper Y") },
    activeDraftId: "x",
    welcomeSeen: true,
  };
  await seedStorage(page, seed, { onlyIfEmpty: true });
  await page.goto("/");
  await expect(page.getByLabel("Draft title")).toHaveValue("Paper X");

  const other = await context.newPage();
  await seedStorage(other, seed, { onlyIfEmpty: true });
  await other.goto("/");
  await other.getByRole("button", { name: /^Drafts:/ }).click();
  await other.getByRole("button", { name: "Switch to Paper Y" }).click();
  await other.getByLabel("Draft title").fill("Paper Y, edited there");
  await other.getByLabel("Draft title").press("Enter");

  await page.getByLabel("Draft title").fill("Paper X, edited here");
  await page.getByLabel("Draft title").press("Enter");

  await expect(other.getByLabel("Draft title")).toHaveValue("Paper Y, edited there");
  // Saved too: a reload opens the draft saved last, so look for it in the picker.
  await other.reload();
  await other.getByRole("button", { name: /^Drafts:/ }).click();
  await expect(other.getByRole("button", { name: "Switch to Paper Y, edited there" })).toHaveCount(1);
  await page.getByRole("button", { name: /^Drafts:/ }).click();
  await page.getByRole("button", { name: "Switch to Paper Y, edited there" }).click();
  await expect(page.getByLabel("Draft title")).toHaveValue("Paper Y, edited there");
});
