// biome-ignore lint/correctness/noNodejsModules: Playwright tests run in Node.
import process from "node:process";
import { expect, test } from "@playwright/test";
import { asReturningVisitor } from "./helpers";

declare global {
  interface Window {
    cspViolations?: string[];
    injectedScriptRan?: boolean;
  }
}

// Every exported page carries its own script hashes in a <meta> CSP
// (scripts/postbuild.mjs), so each one is checked on its own.
const PAGES = ["/", "/about", "/accessibility", "/census"];

test.describe("Content Security Policy", () => {
  test.skip(!process.env.CI, "needs the production build; CI runs one");

  test.beforeEach(async ({ page }) => {
    await asReturningVisitor(page);
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (event) => {
        window.cspViolations = [...(window.cspViolations ?? []), `${event.violatedDirective} ${event.blockedURI}`];
      });
    });
  });

  for (const path of PAGES) {
    test(`${path} runs its own scripts and no injected one`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && /Content Security Policy/i.test(message.text())) {
          consoleErrors.push(message.text());
        }
      });

      // The header carries the rest of the policy, which a meta CSP cannot.
      const csp = (await page.goto(path))?.headers()["content-security-policy"];
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("object-src 'none'");
      await page.waitForLoadState("networkidle");
      // The page hydrated, which needs its inline bootstrap: the theme toggle
      // only gets this label from an effect.
      await expect(
        page.getByRole("banner").getByRole("button", { name: /^Switch to (dark|light) mode$/ }),
      ).toBeVisible();
      expect(await page.evaluate(() => window.cspViolations ?? [])).toEqual([]);
      expect(consoleErrors).toEqual([]);

      const ran = await page.evaluate(() => {
        const script = document.createElement("script");
        script.textContent = "window.injectedScriptRan = true";
        document.body.append(script);
        return window.injectedScriptRan === true;
      });
      expect(ran).toBe(false);
      await expect.poll(() => page.evaluate(() => window.cspViolations?.length ?? 0)).toBe(1);
    });
  }
});
