// biome-ignore-all lint/correctness/noNodejsModules: Playwright tests run in Node.
import { join } from "node:path";
import process from "node:process";
import { expect, test } from "@playwright/test";
import { asReturningVisitor, scan } from "./helpers";

// With READER_MODEL_DIR set for the build too (vite.config.mts), the worker reads that local export at
// /reader-model/, which this routes to its files. The service worker would answer those requests itself.
const local = process.env.READER_MODEL_DIR;
if (local) test.use({ serviceWorkers: "block" });

// Twenty contributors and a statement in their own words, which the rules cannot read.
const AUTHORS = [
  "Marie Curie",
  "Ada Lovelace",
  "Charles Darwin",
  "Rosalind Franklin",
  "Alan Turing",
  "Hua Luogeng",
  "Antonie van Leeuwenhoek",
  "Grace Hopper",
  "Emmy Noether",
  "Niels Bohr",
  "Lise Meitner",
  "Max Planck",
  "Dorothy Hodgkin",
  "Barbara McClintock",
  "Gregor Mendel",
  "Louis Pasteur",
  "Alexander Fleming",
  "Srinivasa Ramanujan",
  "Chien-Shiung Wu",
  "Carl Linnaeus",
];
const STATEMENT =
  "M.C. and A.L. conceived the study and designed the experiments. C.D., R.F. and A.T. carried out the " +
  "field work, and H.L. and A.v.L. collected the samples. G.H. wrote the analysis software and E.N. " +
  "maintained the database. N.B. and L.M. analysed the data and made the figures. M.P. and D.H. checked " +
  "the results. B.M. managed the project and G.M. supervised the lab work. L.P. and A.F. provided the " +
  "reagents and equipment. S.R. obtained the funding. C.-S.W. and C.L. wrote the first draft, and all " +
  "authors revised the manuscript.";

// Over the model's 1,024 tokens: the statement is cut, and the byline read in two chunks that repeat it.
const LONG_STATEMENT = Array(7).fill(STATEMENT).join(" ");

// The model comes from the Hugging Face Hub (75 MB) on a cold profile, as on a first visit, then from the
// browser's cache after a reload. CodSpeed runs no browser, so this is the only check on what the reader
// costs a user, and on the CSP that lets only its worker reach the Hub. Chromium only: one download per run.
// Measured 2026-11-26 on eight pinned desktop cores and four threads: 5.4 s to load cold from the Hub
// (0.8 s cached), 0.8 to 0.9 s to read the 20-author statement and 2.8 to 3.5 s the long one, against
// 2.5 to 2.7 s and 21.6 to 24.0 s reading one author at a time (int8). The budgets leave room for a
// slower runner and download.
const LOAD_BUDGET_MS = 45_000;
const READ_BUDGET_MS = 45_000;

test("the model reads a 20-author statement within budget, and again from the cache", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "times one real download per run");
  test.setTimeout(4 * (LOAD_BUDGET_MS + READ_BUDGET_MS) + 60_000);
  await asReturningVisitor(page);
  if (local) {
    await page.route(/\/reader-model\/[0-9a-f]{12}\/(.+)$/, (route) =>
      route.fulfill({ path: join(local, new URL(route.request().url()).pathname.split("/").slice(3).join("/")) }),
    );
  }
  // A one-pass read can finish between two of Playwright's polls, so the page times the worker's messages.
  await page.addInitScript(() => {
    const times: { sent: number; read?: number; done?: number }[] = [];
    Object.assign(window, { readerTimes: times });
    window.Worker = class extends window.Worker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        if (options?.name !== "statement-reader") return;
        this.addEventListener("message", ({ data }) => {
          const now = times.at(-1);
          if (!now) return;
          if (data.progress?.phase === "read") now.read ??= performance.now();
          if ("result" in data) now.done = performance.now();
        });
      }
    };
  });
  // The worker's requests for the model file, from the Hub or the local export.
  let modelRequests = 0;
  page.on("request", (request) => {
    if (request.url().endsWith("/onnx/model_w8.onnx")) modelRequests += 1;
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#import-text").fill(AUTHORS.join("\n"));
  await page.getByRole("button", { name: "Import data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(AUTHORS.length);

  const readOnce = async (statement: string) => {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-text").fill(statement);
    await page.getByRole("button", { name: "Review roles" }).click();
    const review = page.getByRole("region", { name: "Roles found in the statement" });
    await page.evaluate(() =>
      (window as unknown as { readerTimes: object[] }).readerTimes.push({ sent: performance.now() }),
    );
    await review.getByRole("button", { name: "Read with the model" }).click();
    // The rules catch "software" here, so the model checks their reading rather than standing alone.
    await expect(review.getByText(/^Checked by the model\./)).toBeVisible({ timeout: LOAD_BUDGET_MS + READ_BUDGET_MS });
    await expect(review.getByRole("listitem").filter({ hasText: "Grace Hopper" })).toContainText("Software");
    await expect(review.getByRole("listitem").filter({ hasText: "Sriniv" })).toContainText("Funding acquisition");
    const {
      sent,
      read = sent,
      done = read,
    } = await page.evaluate(
      () =>
        (window as unknown as { readerTimes: { sent: number; read?: number; done?: number }[] }).readerTimes.at(-1) ?? {
          sent: 0,
        },
    );
    const timing = { loadMs: Math.round(read - sent), readMs: Math.round(done - read) };
    expect(timing.loadMs).toBeLessThan(LOAD_BUDGET_MS);
    expect(timing.readMs).toBeLessThan(READ_BUDGET_MS);
    // Close the review, so the next read starts from the grid.
    await page.keyboard.press("Escape");
    return timing;
  };

  const cold = await readOnce(STATEMENT);
  expect((await scan(page)).violations).toEqual([]);
  const coldLong = await readOnce(LONG_STATEMENT);
  expect(modelRequests).toBe(1);
  await page.reload();
  const cached = await readOnce(STATEMENT);
  const cachedLong = await readOnce(LONG_STATEMENT);
  // After the reload the model comes from Cache Storage.
  expect(modelRequests).toBe(1);
  // Threads need cross-origin isolation (COEP in public/_headers); without it the reader runs on one.
  const isolated = await page.evaluate(() => crossOriginIsolated);
  const timings = { isolated, cold, coldLong, cached, cachedLong };
  testInfo.annotations.push({ type: "timing", description: JSON.stringify(timings) });
  // biome-ignore lint/suspicious/noConsole: the timings go to the CI log, where the line reporter hides annotations.
  console.log(`statement reader: ${JSON.stringify(timings)}`);
  expect(isolated).toBe(true);
});
