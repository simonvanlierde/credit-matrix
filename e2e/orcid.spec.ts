// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import { readFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { TEST_ORCID, testIssuer } from "../src/core/__tests__/orcid-test-issuer";
import { decodeShareHash, encodeShareHash } from "../src/core/share-link";
import { asReturningVisitor, copyFrom, onScreen, scan } from "./helpers";

/**
 * ORCID-verified replies. ORCID only sends a browser back to the production
 * page, so the sign-in is stubbed: the authorize page answers at once with a
 * token signed by a test key, sent back to this server, and ORCID's key set
 * serves that key's public half.
 */

function newContext(browser: Browser) {
  return browser.newContext({ permissions: ["clipboard-read", "clipboard-write"] });
}

async function stubOrcid(page: Page, issuer: Awaited<ReturnType<typeof testIssuer>>) {
  await page.route("https://orcid.org/oauth/jwks", (route) =>
    route.fulfill({ json: { keys: issuer.keys }, headers: { "access-control-allow-origin": "*" } }),
  );
  await page.route("https://orcid.org/oauth/authorize?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    expect(params.get("response_type")).toBe("token");
    expect(params.get("scope")).toBe("openid");
    const token = await issuer.sign({ nonce: params.get("nonce") });
    // The real ORCID returns to the registered redirect_uri; here, to whichever page asked.
    const back = `${params.get("redirect_uri")}#access_token=a&token_type=bearer&expires_in=599&id_token=${token}&state=${params.get("state")}`;
    await route.fulfill({ status: 302, headers: { location: back } });
  });
}

test("a co-author signs in with ORCID, and the lead's review shows it, through export and import", async ({
  browser,
}) => {
  const issuer = await testIssuer();

  const lead = await (await newContext(browser)).newPage();
  await asReturningVisitor(lead);
  await stubOrcid(lead, issuer);
  await lead.goto("/");
  const adder = lead.getByLabel("New author names or ORCID iD");
  await adder.fill("Jane Smith, Bob White");
  await adder.press("Enter");
  await lead.getByRole("button", { name: "Actions for Bob White" }).click();
  const ask = await copyFrom(lead, lead.getByRole("button", { name: "Ask Bob White what they did" }));
  await lead.keyboard.press("Escape");

  // The co-author answers, signs in, and sends the answer back.
  const coauthor = await (await newContext(browser)).newPage();
  await asReturningVisitor(coauthor);
  await stubOrcid(coauthor, issuer);
  await coauthor.goto(ask);
  await coauthor
    .getByRole("radiogroup", { name: "Investigation", exact: true })
    .getByRole("radio", { name: "Contributed", exact: true })
    .click();
  await coauthor.getByRole("button", { name: "Sign in with ORCID" }).click();
  await expect(coauthor.getByText(`Signed in with ORCID as Bob White (${TEST_ORCID}).`)).toBeVisible();
  expect(coauthor.url()).not.toContain("id_token");
  expect((await scan(coauthor)).violations).toEqual([]);
  const reply = await copyFrom(coauthor, coauthor.getByRole("button", { name: "Send back" }));

  // Changing the answer after signing in drops the sign-in until the next one.
  await coauthor.getByRole("button", { name: "Change my answer" }).click();
  await coauthor
    .getByRole("radiogroup", { name: "Software", exact: true })
    .getByRole("radio", { name: "Contributed", exact: true })
    .click();
  await expect(coauthor.getByText("You changed your answer after signing in.", { exact: false })).toBeVisible();
  await coauthor.context().close();

  await lead.goto(reply);
  await expect(onScreen(lead, /Bob White's answer arrived/)).toBeVisible();
  await lead.getByRole("tab", { name: /^Review/ }).click();
  const verified = lead.getByText(`Verified by ORCID as Bob White (${TEST_ORCID})`, { exact: false });
  await expect(verified).toBeVisible();
  expect((await scan(lead)).violations).toEqual([]);

  // Export the draft with its answers, and import it into a fresh browser.
  await lead.getByRole("tab", { name: "Statement" }).click();
  await lead.getByRole("button", { name: "Export data" }).click();
  const download = lead.waitForEvent("download");
  await lead.getByRole("button", { name: "Download JSON" }).click();
  // Read before closing: the download goes with its context.
  const file = {
    name: "credit.json",
    mimeType: "application/json",
    buffer: await readFile(await (await download).path()),
  };
  await lead.context().close();

  /** Import `buffer` into a fresh browser and open its Review tab. ORCID's keys check the sign-in again. */
  async function importInto(buffer: Buffer) {
    const fresh = await (await newContext(browser)).newPage();
    await asReturningVisitor(fresh);
    await stubOrcid(fresh, issuer);
    await fresh.goto("/");
    await fresh.getByRole("button", { name: "Import" }).click();
    await fresh.getByLabel("Upload CSV, TSV, JSON, or XML file").setInputFiles({ ...file, buffer });
    await fresh.getByRole("button", { name: "Import data" }).click();
    await fresh.getByRole("tab", { name: /^Review/ }).click();
    return fresh;
  }

  const fresh = await importInto(file.buffer);
  await expect(fresh.getByText(`Verified by ORCID as Bob White (${TEST_ORCID})`, { exact: false })).toBeVisible();
  await fresh.context().close();

  // A file edited to put the sign-in on a different answer imports without the mark.
  const edited = JSON.parse(file.buffer.toString());
  const [bob] = Object.values(edited.asks) as { reply: { contributions: unknown[] } }[];
  if (!bob) throw new Error("expected Bob's answer in the export");
  bob.reply.contributions = [{ role: "Software", score: 100 }];
  const forged = await importInto(Buffer.from(JSON.stringify(edited)));
  await expect(forged.getByRole("heading", { name: "Bob White" })).toBeVisible();
  await expect(forged.locator("[data-orcid-verified]")).toHaveCount(0);
  await forged.context().close();
});

test("a token signed for another answer arrives unverified", async ({ browser }) => {
  const issuer = await testIssuer();
  const lead = await (await newContext(browser)).newPage();
  await asReturningVisitor(lead);
  await stubOrcid(lead, issuer);
  await lead.goto("/");
  const adder = lead.getByLabel("New author names or ORCID iD");
  await adder.fill("Jane Smith, Bob White");
  await adder.press("Enter");
  await lead.getByRole("button", { name: "Actions for Bob White" }).click();
  const ask = await copyFrom(lead, lead.getByRole("button", { name: "Ask Bob White what they did" }));
  await lead.keyboard.press("Escape");

  // A token signed for some other answer, carried by this one.
  const shared = await decodeShareHash(ask.slice(ask.indexOf("#")));
  if (!(shared?.claimId && shared.sourceDraftId)) throw new Error("expected an ask link");
  const forged = await encodeShareHash(
    {
      authors: shared.authors,
      claimId: shared.claimId,
      sourceDraftId: shared.sourceDraftId,
      reply: true,
      sentAt: Date.now(),
      idToken: await issuer.sign({ nonce: "for-another-answer" }),
    },
    ask.split("#")[0],
  );
  await lead.goto(forged);
  await expect(onScreen(lead, /Bob White's answer/)).toBeVisible();
  await lead.getByRole("tab", { name: /^Review/ }).click();
  await expect(lead.locator("[data-orcid-verified]")).toHaveCount(0);
  await lead.context().close();
});
