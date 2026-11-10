// biome-ignore lint/correctness/noNodejsModules: Playwright reads the downloaded file.
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { asReturningVisitor, copyFrom, grantClipboard } from "./helpers";

test("copies and downloads the same RO-Crate attribution fragment", async ({ page, context }) => {
  await asReturningVisitor(page);
  await grantClipboard(context);
  await page.goto("/");
  await page.getByRole("button", { name: "Load sample data" }).click();
  await page.getByRole("button", { name: "Export data" }).click();
  const copied = JSON.parse(await copyFrom(page, page.getByRole("button", { name: "Copy RO-Crate fragment" })));
  expect(copied["@context"]).toBe("https://w3id.org/ro/crate/1.2/context");
  expect(copied["@graph"][0]).toMatchObject({ "@id": "./" });
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download RO-Crate fragment" }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe("credit-ro-crate-fragment.json");
  const file = await downloaded.path();
  if (!file) throw new Error("The fragment download has no local file");
  expect(JSON.parse(await readFile(file, "utf8"))).toEqual(copied);
});
