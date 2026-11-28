// biome-ignore lint/correctness/noNodejsModules: Playwright reads the downloaded export.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { asReturningVisitor, copyFrom, grantClipboard, seedStorage } from "./helpers";

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
  // The picker follows the statement's actions in tab order, just above the panel it opens.
  await page.getByRole("button", { name: "Copy statement" }).focus();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Export data" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "I write in…" })).toBeFocused();
  await page.getByRole("combobox", { name: "I write in…" }).click();
  await page.getByRole("option", { name: "Quarto", exact: true }).click();
  const panel = page.getByRole("region", { name: "Use this in Quarto" });
  await expect(panel.getByRole("textbox", { name: "Quarto YAML" })).toContainText("Ada Lovelace");
  await panel.getByRole("link", { name: "Set up Quarto →", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/quarto$/);
  await expect(page.getByRole("heading", { name: "CRediT statement for Quarto", exact: true })).toBeVisible();
  await page.goBack();
  await page.reload();
  await expect(page.getByRole("combobox", { name: "I write in…" })).toHaveText("Quarto");
  const otherFormats = page.getByRole("button", { name: "Other formats", exact: true });
  await otherFormats.focus();
  await page.keyboard.press("Enter");
  for (const format of ["XML (JATS4R)", "XML (Crossref)", "tenzing CSV"]) {
    await expect(page.getByRole("button", { name: `Download ${format}`, exact: true })).toBeVisible();
  }
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download JSON", exact: true }).click();
  const file = await (await downloading).path();
  if (!file) throw new Error("Missing JSON download");
  const json = JSON.parse(await readFile(file, "utf8"));
  expect(json.toolchain).toBe("quarto");
  await page.keyboard.press("Escape");
  await expect(otherFormats).toBeFocused();
  await page.getByRole("button", { name: "Share", exact: true }).click();
  const link = await copyFrom(page, page.getByRole("button", { name: /Copy.*link/i }));
  const fresh = await browser.newContext();
  const recipient = await fresh.newPage();
  await asReturningVisitor(recipient);
  await recipient.goto(link);
  await expect(recipient.getByRole("combobox", { name: "I write in…" })).toHaveText("Quarto");
  await fresh.close();
});

test("each writing tool renders cleanly and fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("tab", { name: "Statement", exact: true }).click();
  for (const [tool, label] of [
    ["Word", "Word"],
    ["Markdown or plain text", "Markdown"],
    ["LaTeX", "LaTeX"],
    ["Quarto", "Quarto"],
    ["Typst", "Typst"],
    ["Pandoc", "Pandoc"],
    ["MyST or Jupyter Book", "MyST / Jupyter Book"],
    ["Sphinx", "Sphinx"],
  ] as const) {
    await page.getByRole("combobox", { name: "I write in…" }).click();
    await page.getByRole("option", { name: tool, exact: true }).click();
    await expect(page.getByRole("region", { name: `Use this in ${label}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
});

test("Figure settings keeps its own recipe disclosure when a writing tool is selected", async ({ page }) => {
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("combobox", { name: "I write in…" }).click();
  await page.getByRole("option", { name: "Quarto", exact: true }).click();
  await page.getByRole("button", { name: "Heatmap", exact: true }).click();
  await page.getByRole("button", { name: "Figure settings", exact: true }).click();
  await page.getByText("Export recipe", { exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Export recipe", exact: true })).toHaveValue(/contributors\.json/);
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

for (const { locale, title, sample, importLabel } of [
  { locale: "en", title: "", sample: "Load sample data", importLabel: "Import" },
  {
    locale: "en",
    title: "Contribution statements for a manuscript with a deliberately long descriptive title",
    sample: "Load sample data",
    importLabel: "Import",
  },
  {
    locale: "de",
    title: "Beitragserklärungen für ein Manuskript mit einem absichtlich langen beschreibenden Titel",
    sample: "Beispieldaten laden",
    importLabel: "Importieren",
  },
]) {
  for (const { width, fontSize } of [
    { width: 768, fontSize: "16px" },
    { width: 1024, fontSize: "16px" },
    { width: 1280, fontSize: "16px" },
    { width: 1440, fontSize: "16px" },
    { width: 1440, fontSize: "20px" },
  ]) {
    test(`header keeps Import inside ${width}px in ${locale} with ${title ? "a long title" : "the default title"} at ${fontSize}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await seedStorage(page, {
        uiLocale: locale,
        welcomeSeen: true,
        activeDraftId: "header-fit",
        drafts: {
          "header-fit": { id: "header-fit", title, authors: [], inputMode: "levels", updatedAt: 1 },
        },
      });
      await page.goto("/");
      await page.getByRole("button", { name: sample, exact: true }).click();
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size;
      }, fontSize);
      const header = page.locator("[data-app-header]");
      const importButton = header.getByRole("button", { name: importLabel, exact: true });
      await expect(importButton).toBeVisible();
      expect(await importButton.evaluate((button) => button.getBoundingClientRect().right)).toBeLessThanOrEqual(width);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width >= 1024) {
        await expect(
          header.getByRole("link", { name: locale === "de" ? "CRediT-Zensus" : "CRediT census", exact: true }),
        ).toBeVisible();
      }
      const draftPicker = header.locator("[data-draft-actions] > button").first();
      if (title) {
        await expect(draftPicker).toHaveAccessibleName(new RegExp(title));
        const titleLabel = draftPicker.locator("span");
        await expect(titleLabel).toHaveCSS("text-overflow", "ellipsis");
        expect(await titleLabel.evaluate((label) => label.scrollWidth > label.clientWidth)).toBe(true);
      }
      expect(await draftPicker.evaluate((button) => button.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
    });
  }
}
