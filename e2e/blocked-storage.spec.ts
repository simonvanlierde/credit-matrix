// biome-ignore-all lint/correctness/noNodejsModules: Playwright tests run in Node.
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { onScreen } from "./helpers";

// A browser set to block site data throws a SecurityError on any touch of
// `window.localStorage`. The setting lives in the profile, so this test runs
// its own: full Chromium (the headless shell ignores profile preferences)
// with cookies blocked for every site.
test("works, unsaved, when the browser blocks site data", async ({ baseURL }) => {
  const profile = await mkdtemp(join(tmpdir(), "credit-blocked-"));
  await mkdir(join(profile, "Default"));
  await writeFile(
    join(profile, "Default", "Preferences"),
    JSON.stringify({ profile: { default_content_setting_values: { cookies: 2 } } }),
  );
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", baseURL });
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto("/");
    const blocked = await page.evaluate(() => {
      try {
        return window.localStorage === null;
      } catch {
        return true;
      }
    });
    expect(blocked).toBe(true);

    // Nothing stored, so every visit is a first run.
    await expect(page.locator("dialog#getting-started")).toBeVisible();
    await page.keyboard.press("Escape");
    const add = page.getByLabel("New author names or ORCID iD");
    await add.fill("Jane Smith");
    await add.press("Enter");
    await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);
    await expect(onScreen(page, /could not be saved/)).toBeVisible();
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
