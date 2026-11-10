// biome-ignore lint/correctness/noNodejsModules: reads the downloaded YAML in the browser test runner.
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { parse } from "yaml";
import { asReturningVisitor } from "./helpers";

for (const [label, key, filename] of [
  ["Quarto YAML", "author", "credit-quarto.yml"],
  ["MyST YAML", "authors", "credit-myst.yml"],
] as const) {
  test(`copies and downloads ${label} from the current draft`, async ({ page }, testInfo) => {
    await asReturningVisitor(page);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "clipboard", {
        value: {
          writeText: (text: string) => {
            document.documentElement.dataset.copied = text;
            return Promise.resolve();
          },
        },
        configurable: true,
      });
    });
    await page.goto("/");
    const adder = page.getByLabel("New author names or ORCID iD");
    await adder.fill("Lin Wei");
    await adder.press("Enter");
    await page.getByRole("button", { name: /^Software for Lin Wei:/ }).click();
    await page.getByRole("button", { name: "Export data", exact: true }).click();
    await page.getByRole("button", { name: `Copy ${label}`, exact: true }).click();
    const copied = await page.locator("html").getAttribute("data-copied");
    expect(parse(copied ?? "")).toEqual({ [key]: [{ name: "Lin Wei", roles: ["Software"] }] });
    const pending = page.waitForEvent("download");
    await page.getByRole("button", { name: `Download ${label}`, exact: true }).click();
    const download = await pending;
    expect(download.suggestedFilename()).toBe(filename);
    const path = testInfo.outputPath(filename);
    await download.saveAs(path);
    expect(readFileSync(path, "utf8")).toBe(copied);
  });
}
