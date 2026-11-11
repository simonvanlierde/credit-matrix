// Retakes the README screenshot in docs/screenshots/ from a served build.
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
// The getting-started checklist comes and goes with the visitor's progress: keep it out of the shots.
await context.addInitScript(() =>
  localStorage.setItem(
    "credit-matrix-guide",
    JSON.stringify({ state: { copied: false, dismissed: true }, version: 0 }),
  ),
);
const page = await context.newPage();

async function shot(name) {
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${dir}${name}.png` });
  console.log(`wrote docs/screenshots/${name}.png`);
}

// The sample paper, with the Team tab showing who has been asked.
await page.goto(base);
const welcome = page.getByRole("dialog", { name: /three steps/ });
await welcome.getByRole("button", { name: "Load sample data" }).click();
await welcome.waitFor({ state: "hidden" });
await page.getByRole("tab", { name: "Team" }).click();
await shot("hero");

await browser.close();
