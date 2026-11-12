import { expect, test } from "@playwright/test";
import { createAuthor } from "../src/core/parse-authors";
import { PERSIST_KEY } from "../src/store/persist-meta";
import { asReturningVisitor, copyFrom, grantClipboard, scan, seedStorage } from "./helpers";

test("a docs example uses sample data without creating a draft", async ({ page }) => {
  await asReturningVisitor(page);
  await grantClipboard(page.context());
  await page.goto("/docs/quarto");
  await expect(page.getByText("Showing sample data", { exact: true })).toBeVisible();
  const output = page.getByRole("textbox", { name: "Quarto YAML", exact: true });
  await expect(output).toHaveValue(/author:/);
  const before = await page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY);
  expect(await copyFrom(page, page.getByRole("button", { name: "Copy Quarto YAML", exact: true }))).toBe(
    await output.inputValue(),
  );
  const downloaded = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download Quarto YAML", exact: true }).click();
  expect((await downloaded).suggestedFilename()).toBe("credit-quarto.yml");
  expect(await page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY)).toBe(before);
});

test("draft and sample output toggle without changing saved data or executing names", async ({ page }) => {
  const name = 'Alex <img src=x onerror="window.docsInjected=true"> $(echo data)';
  await seedStorage(page, {
    welcomeSeen: true,
    activeDraftId: "paper",
    drafts: {
      paper: {
        authors: [createAuthor(name, { contributions: [{ role: "Software", score: 100 }] })],
        toolchain: "typst",
      },
    },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/docs/typst");
  await expect(page.getByText("Showing your draft", { exact: true })).toBeVisible();
  const output = page.getByRole("textbox", { name: "JSON", exact: true });
  await expect(output).toHaveValue(/Alex/);
  const before = await page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY);
  await page.getByRole("button", { name: "Use sample data", exact: true }).click();
  await expect(page.getByText("Showing sample data", { exact: true })).toBeVisible();
  expect(await output.inputValue()).not.toContain("Alex");
  await page.getByRole("button", { name: "Use your draft", exact: true }).click();
  const json = JSON.parse(await output.inputValue());
  expect(JSON.stringify(json)).toContain("Alex");
  expect(await page.evaluate(() => "docsInjected" in window)).toBe(false);
  expect(await page.evaluate((key) => localStorage.getItem(key), PERSIST_KEY)).toBe(before);
  expect(errors).toEqual([]);
});

test("live controls fit a narrow page and meet the accessibility checks", async ({ page }) => {
  await asReturningVisitor(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/docs/myst");
  await expect(page.getByText("Showing sample data", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  expect((await scan(page, "article")).violations).toEqual([]);
});

test("reference pages do not fetch live example code", async ({ page }) => {
  await asReturningVisitor(page);
  const fetched: string[] = [];
  page.on("request", (request) => fetched.push(request.url()));
  await page.goto("/docs/cli");
  await page.getByRole("button", { name: "Language settings" }).click();
  expect(fetched.filter((url) => /LiveExample|OutputBlock|StatementOutput/.test(url))).toEqual([]);
});

test("the guide remains readable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto("/docs/quarto");
  await expect(page.getByRole("heading", { name: "CRediT statement for Quarto", exact: true })).toBeVisible();
  await expect(page.locator("article pre").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Pandoc guide" })).toHaveAttribute("href", "/docs/pandoc");
  await context.close();
});
