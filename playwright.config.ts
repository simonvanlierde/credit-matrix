// biome-ignore lint/correctness/noNodejsModules: Playwright config runs in Node, not the browser.
import process from "node:process";
import { defineConfig, devices } from "@playwright/test";

// One source of truth for the port. `BASE_URL` wins when set (so a machine
// where 3000 is already taken can run the suite elsewhere); otherwise `PORT`,
// otherwise the default. Previously `baseURL` honoured `BASE_URL` while the
// dev server and the readiness probe stayed hard-coded to 3000, so overriding
// it pointed the tests at one port and the server at another.
const DEFAULT_PORT = 3000;
const baseUrl = process.env.BASE_URL ?? `http://localhost:${process.env.PORT ?? DEFAULT_PORT}`;
const port = new URL(baseUrl).port || "80";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
  webServer: {
    command: process.env.CI ? `pnpm build && pnpm start --port ${port}` : `pnpm dev --port ${port}`,
    url: baseUrl,
    reuseExistingServer: !process.env.CI,
  },
});
