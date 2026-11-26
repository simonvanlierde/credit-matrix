import { expect, test } from "@playwright/test";
import { asReturningVisitor, scan } from "./helpers";

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

// The model comes from the Hugging Face Hub (70 MB) on a cold profile, as on a first visit, then from the
// browser's cache after a reload. CodSpeed runs no browser, so this is the only check on what the reader
// costs a user, and on the CSP that lets only its worker reach the Hub. Chromium only: one download per run.
// Measured 2026-11-26 on eight cores of a desktop CPU, two runs each: 3.1 to 3.7 s to load cold (1.1 to
// 1.2 s cached), and 2.2 to 2.8 s to read the 164-token statement on four threads, against 8.8 to 9.3 s on
// one. The budgets leave room for a slower runner and download, and still catch a tenfold slowdown.
const LOAD_BUDGET_MS = 45_000;
const READ_BUDGET_MS = 45_000;

test("the model reads a 20-author statement within budget, and again from the cache", async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== "chromium", "times one real download per run");
  test.setTimeout(2 * (LOAD_BUDGET_MS + READ_BUDGET_MS) + 60_000);
  await asReturningVisitor(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.locator("#import-text").fill(AUTHORS.join("\n"));
  await page.getByRole("button", { name: "Import data" }).click();
  await expect(page.getByRole("button", { name: /^Remove / })).toHaveCount(AUTHORS.length);

  const readOnce = async () => {
    await page.getByRole("button", { name: "Import", exact: true }).click();
    await page.locator("#import-text").fill(STATEMENT);
    await page.getByRole("button", { name: "Review roles" }).click();
    const review = page.getByRole("region", { name: "Roles found in the statement" });
    const started = Date.now();
    await review.getByRole("button", { name: "Read with the model" }).click();
    await expect(page.getByText(/^Reading the statement/)).toBeVisible({ timeout: LOAD_BUDGET_MS });
    const loaded = Date.now();
    // The rules catch "software" here, so the model checks their reading rather than standing alone.
    await expect(review.getByText(/^Checked by the model\./)).toBeVisible({ timeout: READ_BUDGET_MS });
    const read = Date.now();
    await expect(review.getByRole("listitem").filter({ hasText: "Grace Hopper" })).toContainText("Software");
    await expect(review.getByRole("listitem").filter({ hasText: "Sriniv" })).toContainText("Funding acquisition");
    return { loadMs: loaded - started, readMs: read - loaded, perAuthorMs: Math.round((read - loaded) / 20) };
  };

  const cold = await readOnce();
  expect((await scan(page)).violations).toEqual([]);
  await page.reload();
  const cached = await readOnce();
  // Threads need cross-origin isolation (COEP in public/_headers); without it the reader runs on one.
  const isolated = await page.evaluate(() => crossOriginIsolated);
  const timings = { isolated, cold, cached };
  testInfo.annotations.push({ type: "timing", description: JSON.stringify(timings) });
  // biome-ignore lint/suspicious/noConsole: the timings go to the CI log, where the line reporter hides annotations.
  console.log(`statement reader: ${JSON.stringify(timings)}`);
  expect(isolated).toBe(true);
});
