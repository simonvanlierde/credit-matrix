// Retakes the README screenshots in docs/screenshots/ from a served build.
// Usage: see docs/screenshots/README.md.
// biome-ignore-all lint/correctness/noNodejsModules: Node script, not client code.
// biome-ignore-all lint/suspicious/noConsole: console is the script's progress output.
import process from "node:process";
import { chromium } from "@playwright/test";

const base = process.argv[2] ?? "http://127.0.0.1:4461/";
const dir = new URL("../docs/screenshots/", import.meta.url).pathname;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  colorScheme: "light",
  reducedMotion: "reduce",
});
const page = await context.newPage();

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}${name}.png` });
  console.log(`wrote docs/screenshots/${name}.png`);
}

// First visit: the welcome opens on its own over the empty workspace.
await page.goto(base);
const welcome = page.getByRole("dialog", { name: /three steps/ });
await welcome.waitFor();
await shot("empty-state");

// Hero: the sample paper, with the Team tab showing who has been asked.
await welcome.getByRole("button", { name: "Load sample data" }).click();
await welcome.waitFor({ state: "hidden" });
await page.getByRole("tab", { name: "Team" }).click();
await shot("hero");

// The statement with the export menu open.
await page.getByRole("tab", { name: "Statement" }).click();
await page.getByRole("button", { name: "Export data" }).click();
await shot("statement-export");

await browser.close();
