// biome-ignore lint/correctness/noNodejsModules: Playwright reads the downloaded export.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { asReturningVisitor, copyFrom, grantClipboard } from "./helpers";

test("writing tool survives reload, export and share while journal files stay available", async ({
  page,
  context,
  browser,
}) => {
  await asReturningVisitor(page);
  await grantClipboard(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("combobox", { name: "I write in…" })).toHaveText("All formats");
  await expect(page.getByRole("heading", { name: "For the journal" })).toBeVisible();
  await page.getByRole("combobox", { name: "I write in…" }).click();
  await page.getByRole("option", { name: "Quarto", exact: true }).click();
  const panel = page.getByRole("region", { name: "Use this in Quarto" });
  await expect(panel.getByRole("textbox", { name: "Quarto YAML" })).toContainText("Ada Lovelace");
  await expect(panel.getByRole("textbox", { name: "Export recipe", exact: true })).toHaveValue(
    /credit-matrix:\n {2}heatmap: true/,
  );
  await expect(panel.getByRole("textbox", { name: "CLI equivalent" })).toHaveValue(
    /^credit-matrix convert contributors.json --to svg/,
  );
  for (const format of ["XML (JATS4R)", "XML (Crossref)", "tenzing CSV"]) {
    await expect(page.getByRole("button", { name: `Download ${format}`, exact: true })).toBeVisible();
  }
  await panel.getByRole("link", { name: "Set up Quarto →", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/quarto$/);
  await expect(page.getByRole("heading", { name: "CRediT statement for Quarto", exact: true })).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "I write in…" })).toHaveText("Quarto");
  await page.getByRole("button", { name: "Other formats", exact: true }).click();
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON", exact: true }).click();
  const file = await (await downloading).path();
  if (!file) throw new Error("Missing JSON download");
  const json = JSON.parse(await readFile(file, "utf8"));
  expect(json.toolchain).toBe("quarto");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await copyFrom(page, page.getByRole("button", { name: /Copy.*link/i }));
  const fresh = await browser.newContext();
  const recipient = await fresh.newPage();
  await asReturningVisitor(recipient);
  await recipient.goto(link);
  await expect(recipient.getByRole("combobox", { name: "I write in…" })).toHaveText("Quarto");
  await fresh.close();
});

test("each writing tool keeps the journal group and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  for (const tool of [
    "Word",
    "Markdown or plain text",
    "LaTeX",
    "Quarto",
    "Typst",
    "Pandoc",
    "MyST or Jupyter Book",
    "Sphinx",
  ]) {
    await page.getByRole("combobox", { name: "I write in…" }).click();
    await page.getByRole("option", { name: tool, exact: true }).click();
    await expect(page.getByRole("heading", { name: "For the journal" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByRole("textbox", { name: "CLI equivalent" })).toHaveValue(/contributors.json/);
  }
});

test("Figure settings closes when following the selected tool's recipe", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("combobox", { name: "I write in…" }).click();
  await page.getByRole("option", { name: "Quarto", exact: true }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.getByRole("link", { name: "Export recipe", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Heatmap", exact: true })).not.toBeVisible();
  await expect(page.locator("#toolchain-heatmap-recipe")).toBeFocused();
});

test("Undo restores the roster a plain import replaced after a tool pick", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
  await page.getByRole("button", { name: "Import" }).click();
  await page.locator("#import-text").fill("Marie Curie");
  await page.getByRole("button", { name: "Import data" }).click();
  await page.getByRole("button", { name: "Replace workspace" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(1);
  await page.getByRole("combobox", { name: "I write in…" }).click();
  await page.getByRole("option", { name: "Quarto", exact: true }).click();
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(3);
});
