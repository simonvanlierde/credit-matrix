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
      // transformers-cache holds the statement reader's 70 MB model, which a deploy must not delete.
      keys: async () => ["credit-matrix-v0-docs", "transformers-cache"],
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
  expect(remove).not.toHaveBeenCalledWith("transformers-cache");
  expect(claim).toHaveBeenCalledOnce();
});

type Listener = (event: {
  request?: { url: string; method: string; mode: string };
  respondWith?: (response: Promise<unknown>) => void;
  waitUntil: (work: Promise<void>) => void;
}) => void;

/** Runs the worker with stamped docs pages and the given globals; returns its event listeners. */
function loadWorker(globals: Record<string, unknown>) {
  const listeners: Record<string, Listener> = {};
  const source = readFileSync("public/sw.js", "utf8")
    .replace("const PAGES = [];", 'const PAGES = ["/", "/about", "/docs/quarto", "/docs/typst"];')
    .replace(
      "const DOCS_ASSETS = {};",
      'const DOCS_ASSETS = {"/docs/quarto": ["/assets/docs.js", "/assets/a.png"], "/docs/typst": ["/assets/docs.js"]};',
    );
  runInNewContext(source, {
    URL,
    AbortController,
    AbortSignal,
    Request: class {
      url: string;
      constructor(path: string) {
        this.url = path;
      }
    },
    self: {
      location: { origin: "https://example.org" },
      addEventListener: (type: string, listener: Listener) => {
        listeners[type] = listener;
      },
      clients: { claim: vi.fn() },
    },
    ...globals,
  });
  return listeners;
}

const navigate = (listeners: Record<string, Listener>, path: string) =>
  new Promise<unknown>((resolve) => {
    listeners.fetch?.({
      request: { url: `https://example.org${path}`, method: "GET", mode: "navigate" },
      respondWith: (response) => void response.then(resolve),
      waitUntil: () => undefined,
    });
  });

it("carries two visited docs pages that share a chunk in one list without repeats", async () => {
  const addAll = vi.fn((requests: { url: string }[]) => {
    const urls = requests.map((request) => request.url);
    return new Set(urls).size === urls.length
      ? Promise.resolve()
      : Promise.reject(new Error("InvalidStateError: duplicate requests"));
  });
  const listeners = loadWorker({
    caches: {
      keys: async () => ["credit-matrix-v0-docs"],
      delete: vi.fn(),
      open: async () => ({
        keys: async () => [{ url: "https://example.org/docs/quarto" }, { url: "https://example.org/docs/typst" }],
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
  await activation;
  await expect(addAll.mock.results[0]?.value).resolves.toBeUndefined();
  expect(addAll.mock.calls[0]?.[0].map((request) => request.url)).toEqual([
    "/docs/quarto",
    "/assets/docs.js",
    "/assets/a.png",
    "/docs/typst",
  ]);
});

it.each([
  ["/docs/quarto", "error"],
  ["/about", "home"],
])("offline, an uncached %s answers with %s", async (path, expected) => {
  const home = { page: "home" };
  const error = { page: "error" };
  const listeners = loadWorker({
    fetch: () => Promise.reject(new TypeError("offline")),
    Response: { error: () => error },
    caches: { match: async (key: string) => (key === "/" ? home : undefined) },
  });
  expect(await navigate(listeners, path)).toBe(expected === "home" ? home : error);
});

it("stops the navigation deadline once the headers arrive", async () => {
  const signals: AbortSignal[] = [];
  const clearTimeout = vi.fn();
  const listeners = loadWorker({
    fetch: (_request: unknown, init: { signal: AbortSignal }) => {
      signals.push(init.signal);
      return Promise.resolve({ ok: true, status: 200, clone: () => ({}) });
    },
    setTimeout: () => 7,
    clearTimeout,
    caches: { open: async () => ({ put: async () => undefined }) },
  });
  await navigate(listeners, "/about");
  expect(clearTimeout).toHaveBeenCalledWith(7);
  expect(signals[0]?.aborted).toBe(false);
});

it.each([
  ["/docs/quarto", "network"],
  ["/about", "home"],
])("headers slower than the deadline: an uncached %s answers with %s", async (path, expected) => {
  const home = { page: "home" };
  const network = { ok: true, status: 200, clone: () => ({}) };
  const listeners = loadWorker({
    fetch: (_request: unknown, init: { signal: AbortSignal }) =>
      new Promise((resolve, reject) => {
        const abort = () => reject(new DOMException("aborted", "AbortError"));
        if (init.signal.aborted) abort();
        init.signal.addEventListener("abort", abort);
        setTimeout(() => resolve(network), 20);
      }),
    // The deadline passes at once, before the headers arrive.
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
    clearTimeout: () => undefined,
    Response: { error: () => ({ page: "error" }) },
    caches: {
      match: async (key: string) => (key === "/" ? home : undefined),
      open: async () => ({ put: async () => undefined }),
    },
  });
  expect(await navigate(listeners, path)).toBe(expected === "home" ? home : network);
});
