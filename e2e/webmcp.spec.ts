import { expect, type Page, test } from "@playwright/test";
import { asReturningVisitor, onScreen } from "./helpers";

declare global {
  interface Window {
    __tools: Map<
      string,
      {
        name: string;
        annotations?: {
          readOnlyHint?: boolean;
          consequentialHint?: boolean;
          untrustedContentHint?: boolean;
        };
        execute: (input: unknown, context?: { signal?: AbortSignal }) => Promise<unknown>;
      }
    >;
    __refused: string[];
    __stop?: AbortController;
  }
}

// Stand-in for `navigator.modelContext`: keeps registered tools as a browser agent sees them,
// refuses duplicate names and aborted signals, and unregisters on abort.
async function withModelContext(page: Page) {
  await page.addInitScript(() => {
    const tools = new Map();
    window.__tools = tools;
    window.__refused = [];
    const modelContext = {
      registerTool: (tool: { name: string }, { signal }: { signal?: AbortSignal } = {}) => {
        if (signal?.aborted || tools.has(tool.name)) {
          window.__refused.push(tool.name);
          return Promise.reject(new DOMException(`refused ${tool.name}`, "InvalidStateError"));
        }
        tools.set(tool.name, tool);
        signal?.addEventListener("abort", () => tools.delete(tool.name));
        return Promise.resolve();
      },
    };
    Object.defineProperty(Navigator.prototype, "modelContext", { get: () => modelContext, configurable: true });
  });
}

// Agent tool call: round-trips JSON input and output, passing an AbortSignal.
const call = (page: Page, name: string, input: Record<string, unknown> = {}) =>
  page.evaluate(
    async ([toolName, payload]) => {
      window.__stop = new AbortController();
      const tool = window.__tools.get(toolName);
      if (!tool) return { error: `missing tool ${toolName}` };
      try {
        const out = await tool.execute(JSON.parse(payload), { signal: window.__stop.signal });
        return { ok: JSON.parse(JSON.stringify(out)) };
      } catch (error) {
        return { error: error instanceof Error ? error.message : String(error) };
      }
    },
    [name, JSON.stringify(input)] as const,
  );

test("agent lists roles, imports contributors, sets roles with Undo, and reads matrix and statement", async ({
  page,
}) => {
  await asReturningVisitor(page);
  await withModelContext(page);
  await page.goto("/");
  await page.waitForFunction(() => window.__tools.size === 5);

  expect(await page.evaluate(() => window.__refused)).toEqual([]);
  const registered = await page.evaluate(() =>
    [...window.__tools.values()].map((t) => [
      t.name,
      t.annotations?.readOnlyHint ?? false,
      t.annotations?.consequentialHint ?? false,
      t.annotations?.untrustedContentHint ?? false,
    ]),
  );
  expect(registered).toEqual([
    ["list_roles", true, false, false],
    ["get_matrix", true, false, true],
    ["import_contributors", false, true, true],
    ["set_role", false, true, false],
    ["get_statement", true, false, true],
  ]);

  const roles = await call(page, "list_roles");
  expect(roles.error).toBeUndefined();
  expect(roles.ok.roles).toHaveLength(14);
  expect(roles.ok.levels.map((l: { name: string }) => l.name)).toEqual(["none", "supporting", "equal", "lead"]);

  // Import contributors via name list (default add mode) and verify Undo toast works.
  const imported = await call(page, "import_contributors", { text: "Grace B. Hopper\nAda Lovelace" });
  expect(imported.error).toBeUndefined();
  expect(imported.ok).toEqual({ format: "names", mode: "add", count: 2, total: 2 });
  await expect(onScreen(page, /Added 2 contributors/i)).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const afterUndo = await call(page, "get_matrix");
  expect(afterUndo.ok.authors).toHaveLength(0);

  // Import again and set a role.
  await call(page, "import_contributors", { text: "Grace B. Hopper\nAda Lovelace", mode: "replace" });
  const setRes = await call(page, "set_role", { author: "Grace B. Hopper", role: "Software", level: "lead" });
  expect(setRes.error).toBeUndefined();
  expect(setRes.ok.role).toBe("Software");
  expect(setRes.ok.score).toBe(100);
  await expect(onScreen(page, /Grace B\. Hopper: Software \(lead\)/)).toBeVisible();

  // Undo the set_role write.
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  const afterRoleUndo = await call(page, "get_statement", { format: "by-author" });
  expect(afterRoleUndo.ok.statement).toBe("");

  // Set roles again and verify get_matrix + get_statement.
  await call(page, "set_role", { author: "Grace B. Hopper", role: "Software", level: "lead" });
  await call(page, "set_role", { author: "Ada Lovelace", role: "Conceptualization", level: "equal" });

  const matrix = await call(page, "get_matrix");
  expect(matrix.error).toBeUndefined();
  expect(matrix.ok.version).toBe(2);
  expect(matrix.ok.authors).toHaveLength(2);

  const statement = await call(page, "get_statement", { format: "by-author-short", showLevels: true });
  expect(statement.error).toBeUndefined();
  expect(statement.ok.statement).toBe("CRediT: GBH: Software; AL: Conceptualization (Equal)");

  // Validation errors leave the workspace unchanged.
  expect((await call(page, "set_role", { author: "Nobody", role: "Software", level: "lead" })).error).toContain(
    "No contributor",
  );
  expect((await call(page, "set_role", { author: "Ada Lovelace", role: "Invalid", level: "lead" })).error).toContain(
    "Unknown CRediT role",
  );
  expect((await call(page, "get_statement", { format: "nope" })).error).toContain("Unknown statement format");
});

test("non-workspace routes register no tools and returning to / registers all five cleanly", async ({ page }) => {
  await asReturningVisitor(page);
  await withModelContext(page);
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await page.evaluate(() => window.__tools.size)).toBe(0);

  await page.goto("/");
  await page.waitForFunction(() => window.__tools.size === 5);
  expect(await page.evaluate(() => window.__refused)).toEqual([]);
});

test("without navigator.modelContext, the webmcp chunk is never requested", async ({ page }) => {
  const webmcpRequests: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("webmcp")) webmcpRequests.push(req.url());
  });
  await asReturningVisitor(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(webmcpRequests).toEqual([]);
});
