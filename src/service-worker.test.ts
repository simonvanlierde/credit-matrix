// biome-ignore lint/correctness/noNodejsModules: this test runs the worker in an isolated Node context.
import { readFileSync } from "node:fs";
// biome-ignore lint/correctness/noNodejsModules: no browser service worker is needed for its lifecycle test.
import { runInNewContext } from "node:vm";
import { expect, it, vi } from "vitest";

it.each([false, true])("activation finishes when docs cache warming stalls: %s", async (stalled) => {
  const controller = new AbortController();
  const timeout = vi.fn(() => controller.signal);
  const claim = vi.fn();
  const remove = vi.fn();
  const addAll = vi.fn(async (requests: { signal?: AbortSignal }[]) => {
    if (stalled && requests.length) {
      await new Promise((_, reject) => {
        requests[0]?.signal?.addEventListener("abort", () => reject(new Error("timed out")), { once: true });
      });
    }
  });
  const listeners: Record<string, (event: { waitUntil: (work: Promise<void>) => void }) => void> = {};
  const source = readFileSync("public/sw.js", "utf8").replace("const PAGES = [];", 'const PAGES = ["/docs/quarto"];');
  runInNewContext(source, {
    URL,
    Request: class {
      signal?: AbortSignal;
      constructor(_path: string, options: { signal?: AbortSignal }) {
        this.signal = options.signal;
      }
    },
    AbortSignal: { timeout },
    self: {
      addEventListener: (type: string, listener: (typeof listeners)[string]) => {
        listeners[type] = listener;
      },
      clients: { claim },
    },
    caches: {
      keys: async () => ["credit-matrix-v0-docs"],
      delete: remove,
      open: async () => ({
        keys: async () => [{ url: "https://example.org/docs/quarto" }],
        match: async () => undefined,
        addAll,
      }),
    },
  });
  let activation: Promise<void> | undefined;
  listeners.activate?.({
    waitUntil: (work) => {
      activation = work;
    },
  });
  await vi.waitFor(() => expect(addAll).toHaveBeenCalled());
  if (stalled) {
    expect(claim).not.toHaveBeenCalled();
    controller.abort();
  }
  await expect(
    Promise.race([
      activation?.then(() => "activated"),
      new Promise((resolve) => setTimeout(() => resolve("pending"), 100)),
    ]),
  ).resolves.toBe("activated");
  if (stalled) expect(timeout).toHaveBeenCalledWith(15_000);
  expect(remove).toHaveBeenCalledWith("credit-matrix-v0-docs");
  expect(claim).toHaveBeenCalledOnce();
});
