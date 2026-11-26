// biome-ignore lint/correctness/noNodejsModules: the test hashes the fake model as census does.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReaderReply } from "./statement-reader";
import { CACHE, STALL_MS } from "./statement-reader.worker";

const MODEL = new Uint8Array([1, 2, 3, 4]);
const pins = vi.hoisted(() => ({
  repo: "simonvanlierde/credit-statement-reader",
  revision: "0123456789abcdef0123456789abcdef01234567",
  sha256: {} as Record<string, string>,
  bytes: {} as Record<string, number>,
  base: undefined as string | undefined,
}));
vi.mock("../../census/model.json", () => ({ default: pins }));
const ort = vi.hoisted(() => ({
  env: { wasm: {} as Record<string, unknown> },
  create: vi.fn(),
  run: vi.fn(),
  release: vi.fn(),
}));
vi.mock("onnxruntime-web/wasm", () => ({
  env: ort.env,
  InferenceSession: { create: ort.create },
  Tensor: class {
    constructor(
      readonly type: string,
      readonly data: BigInt64Array,
      readonly dims: number[],
    ) {}
  },
}));
vi.mock("onnxruntime-web/ort-wasm-simd-threaded.wasm?url", () => ({ default: "/assets/ort.wasm" }));

// One byte-level token per letter; "Ada" is [10, 11, 12], "S" [13].
const TOKENIZER = {
  model: { vocab: { A: 10, d: 11, a: 12, S: 13, C: 14 }, merges: [] },
  added_tokens: [
    { id: 1, content: "[CLS]" },
    { id: 2, content: "[SEP]" },
    { id: 3, content: "[unused0]" },
  ],
};
const BASE = `https://huggingface.co/${pins.repo}/resolve/${pins.revision}/`;
let files: Record<string, string | Uint8Array<ArrayBuffer>>;
const replies: ReaderReply[] = [];
const cached = new Map<string, Response>();
const opened: string[] = [];
const dropped: string[] = [];
let handle: (data: unknown) => Promise<void>;
const last = () => replies.at(-1);
const logits = (...rows: number[][]) => ({ logits: { data: Float32Array.from(rows.flat()) } });
const pin = (file: string) => {
  const body = files[file] ?? "";
  pins.sha256[file] = createHash("sha256").update(body).digest("hex");
  pins.bytes[file] = Buffer.byteLength(body);
};
/** The model's body, sent as these pieces, `apart` ms apart, and then ended unless `open`. */
function serveModel(pieces: Uint8Array[], apart = 0, open = false) {
  vi.mocked(fetch).mockImplementation((url) => {
    const file = String(url).slice(BASE.length);
    if (file !== "onnx/model_w8.onnx") return Promise.resolve(new Response(files[file]));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (sent === pieces.length) return open ? new Promise(() => undefined) : controller.close();
        if (apart) await new Promise((resolve) => setTimeout(resolve, apart));
        controller.enqueue(pieces[sent++] ?? new Uint8Array());
      },
    });
    // Not a Response, whose body Node pipes through timers of its own.
    return Promise.resolve({ ok: true, status: 200, body } as Response);
  });
}

async function start() {
  vi.resetModules();
  await import("./statement-reader.worker");
  handle = (data) => (self.onmessage as unknown as (e: { data: unknown }) => Promise<void>)({ data });
}

beforeEach(async () => {
  pins.base = undefined;
  replies.length = 0;
  cached.clear();
  opened.length = 0;
  dropped.length = 0;
  files = {
    "tokenizer.json": JSON.stringify(TOKENIZER),
    "config.json": JSON.stringify({ id2label: { 0: "software", 1: "validation" } }),
    "best.json": JSON.stringify({ threshold: 0.4 }),
    "onnx/model_w8.onnx": MODEL,
  };
  for (const file of Object.keys(files)) pin(file);
  vi.stubGlobal("postMessage", (reply: ReaderReply) => replies.push(reply));
  vi.stubGlobal("caches", {
    delete: async (name: string) => dropped.push(name) > 0,
    open: (name: string) => {
      opened.push(name);
      return Promise.resolve({
        // Keyed by absolute URL, as Cache Storage keys them.
        match: async (url: string) => cached.get(new URL(url, location.href).href)?.clone(),
        put: async (url: string, response: Response) => void cached.set(new URL(url, location.href).href, response),
        keys: async () => [...cached.keys()].map((url) => new Request(url)),
        delete: async (request: Request) => cached.delete(request.url),
      });
    },
  });
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      const body = files[url.slice(BASE.length)];
      return Promise.resolve(body === undefined ? new Response("", { status: 404 }) : new Response(body));
    }),
  );
  ort.create.mockResolvedValue({ run: ort.run, release: ort.release });
  ort.run.mockImplementation(async ({ marker_positions }) =>
    logits(...Array.from(marker_positions.data, () => [0, 10])),
  );
  await start();
});

afterEach(() => vi.unstubAllGlobals());

describe("the statement reader worker", () => {
  it("runs on this site's CPU runtime, with one thread unless cross-origin isolated", async () => {
    expect(ort.env.wasm).toEqual({ wasmPaths: { wasm: "/assets/ort.wasm" }, numThreads: 1 });
    vi.stubGlobal("crossOriginIsolated", true);
    for (const [cores, threads] of [
      [16, 4],
      [2, 2],
    ]) {
      vi.stubGlobal("navigator", { hardwareConcurrency: cores });
      await start();
      expect(ort.env.wasm.numThreads).toBe(threads);
    }
  });

  it("leaves onnxruntime's thread workers, which load this same script, their own message handler", async () => {
    self.onmessage = null;
    vi.stubGlobal("name", "em-pthread-1");
    await start();
    expect(self.onmessage).toBeNull();
  });

  it("reads every author in one pass, and returns probabilities with the config's labels", async () => {
    await handle({ id: 3, statement: "S", authors: ["Ada", "C"] });
    expect(ort.create).toHaveBeenCalledWith(new Uint8Array(MODEL), { executionProviders: ["wasm"] });
    expect(ort.run).toHaveBeenCalledTimes(1);
    const { input_ids, attention_mask, marker_positions } = ort.run.mock.calls[0]?.[0] ?? {};
    expect([...input_ids.data]).toEqual([1n, 3n, 10n, 11n, 12n, 3n, 14n, 2n, 13n, 2n]);
    expect(input_ids.dims).toEqual([1, 10]);
    // The graph's inputs are int64: int32 tensors fail in onnxruntime.
    expect([input_ids.type, attention_mask.type, marker_positions.type]).toEqual(["int64", "int64", "int64"]);
    expect([...attention_mask.data]).toEqual(Array(10).fill(1n));
    expect([...marker_positions.data]).toEqual([1n, 5n]);
    expect(replies.slice(0, -1)).toEqual([
      { progress: { phase: "download", percent: 100 } },
      { id: 3, progress: { phase: "read", done: 0, of: 2 } },
    ]);
    const sure = 1 / (1 + Math.exp(-10));
    expect(last()).toEqual({
      id: 3,
      result: {
        labels: ["software", "validation"],
        threshold: 0.4,
        probabilities: [
          [0.5, sure],
          [0.5, sure],
        ],
      },
    });
  });

  it("reads a long byline in chunks, and puts each author's row back in byline order", async () => {
    // 300 letters each: cut at 256, so three authors fit beside the statement and the fourth goes on.
    const long = (letter: string) => letter.repeat(300);
    ort.run.mockImplementation(async ({ marker_positions }) =>
      logits(...Array.from(marker_positions.data, (_, k) => [ort.run.mock.calls.length, k])),
    );
    await handle({ id: 0, statement: "S", authors: [long("A"), long("d"), long("a"), long("C")] });
    expect(ort.run.mock.calls.map(([{ input_ids }]) => input_ids.dims[1])).toEqual([3 * 257 + 4, 257 + 4]);
    expect(replies.flatMap((r) => ("progress" in r && r.progress.phase === "read" ? [r.progress] : []))).toEqual([
      { phase: "read", done: 0, of: 4 },
      { phase: "read", done: 3, of: 4 },
    ]);
    const result = last();
    const rows = result && "result" in result ? result.result.probabilities : [];
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    expect(rows).toEqual([
      [sigmoid(1), sigmoid(0)],
      [sigmoid(1), sigmoid(1)],
      [sigmoid(1), sigmoid(2)],
      [sigmoid(2), sigmoid(0)],
    ]);
  });

  it("caches the export's files at the pinned commit, and loads the model once", async () => {
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect([...cached.keys()].sort()).toEqual(
      Object.keys(files)
        .map((f) => BASE + f)
        .sort(),
    );
    expect(new Set(opened)).toEqual(new Set([CACHE]));
    // A new page reads them from the cache.
    await start();
    await handle({ id: 2, statement: "S", authors: ["Ada"] });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(last()).toHaveProperty("result");
    expect(ort.create).toHaveBeenCalledTimes(2);
  });

  it("reads on when the cache is full", async () => {
    vi.stubGlobal("caches", {
      open: async () => ({
        match: async () => undefined,
        put: async () => Promise.reject(new Error("quota")),
        keys: async () => [],
      }),
    });
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
  });

  it("refuses a model file that is not the one model.json pins, and caches nothing of it", async () => {
    files["onnx/model_w8.onnx"] = new Uint8Array([1, 2, 3, 5]);
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "onnx/model_w8.onnx is not the file census/model.json pins." });
    files["onnx/model_w8.onnx"] = new Uint8Array([1, 2, 3]);
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 1, error: "onnx/model_w8.onnx is not the file census/model.json pins." });
    expect(cached.has(`${BASE}onnx/model_w8.onnx`)).toBe(false);
  });

  it("refuses to load a model that model.json does not pin", async () => {
    delete pins.bytes["onnx/model_w8.onnx"];
    await start();
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "census/model.json pins no onnx/model_w8.onnx." });
  });

  it("refuses a tokenizer without the model's marker", async () => {
    files["tokenizer.json"] = JSON.stringify({ ...TOKENIZER, added_tokens: TOKENIZER.added_tokens.slice(0, 2) });
    pin("tokenizer.json");
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "tokenizer.json has no [unused0]." });
  });

  it("reports a failed download and tries again on the next request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "tokenizer.json: HTTP 503" });
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
  });

  it("reports a model the runtime cannot load, and tries again on the next request", async () => {
    ort.create.mockRejectedValueOnce("out of memory");
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "out of memory" });
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
  });

  it("releases a session that loads after a JSON file was refused", async () => {
    files["best.json"] = JSON.stringify({ threshold: "0.4" });
    pin("best.json");
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "best.json has no threshold." });
    expect(ort.release).toHaveBeenCalledOnce();
  });

  it("releases a session the runtime makes after the load failed, which it cannot cancel", async () => {
    let made!: (session: unknown) => void;
    let creating!: () => void;
    const created = new Promise<void>((resolve) => {
      creating = resolve;
    });
    ort.create.mockImplementationOnce(() => {
      creating();
      return new Promise((resolve) => {
        made = resolve;
      });
    });
    vi.mocked(fetch).mockImplementation(async (url) => {
      const file = String(url).slice(BASE.length);
      if (file !== "best.json") return new Response(files[file]);
      await created;
      return new Response("", { status: 404 });
    });
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "best.json: HTTP 404" });
    expect(ort.release).not.toHaveBeenCalled();
    made({ run: ort.run, release: ort.release });
    await vi.waitFor(() => expect(ort.release).toHaveBeenCalledOnce());
  });

  it("puts a model that arrives in uneven pieces back together", async () => {
    serveModel([Uint8Array.of(1), Uint8Array.of(2, 3), new Uint8Array(), Uint8Array.of(4)]);
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(ort.create).toHaveBeenCalledWith(new Uint8Array(MODEL), { executionProviders: ["wasm"] });
    expect(last()).toHaveProperty("result");
  });

  it("stops each cancelled request between chunks, not only the last one cancelled", async () => {
    const long = "A".repeat(300);
    // A cancel reaches the worker as its own message task, so it only lands while the read yields.
    const cancelling = (id: number) => () => {
      setTimeout(() => void handle({ cancel: id }), 0);
      return Promise.resolve(logits([0, 0], [0, 0], [0, 0]));
    };
    ort.run.mockImplementationOnce(cancelling(4)).mockImplementationOnce(cancelling(5));
    await Promise.all([4, 5].map((id) => handle({ id, statement: "S", authors: [long, long, long, long] })));
    expect(ort.run).toHaveBeenCalledTimes(2);
    expect(replies.some((r) => "result" in r || "error" in r)).toBe(false);
    await handle({ id: 6, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
  });

  it("gives up on a download that sends nothing for a minute, and starts over on the next request", async () => {
    expect(STALL_MS).toBe(60_000);
    vi.useFakeTimers();
    try {
      let signal: AbortSignal | undefined;
      vi.mocked(fetch).mockImplementationOnce((_, init) => {
        signal = init?.signal ?? undefined;
        return new Promise(() => undefined);
      });
      const stalled = handle({ id: 0, statement: "S", authors: ["Ada"] });
      await vi.advanceTimersByTimeAsync(STALL_MS);
      await stalled;
      expect(last()).toEqual({ id: 0, error: "The model download stalled." });
      expect(signal?.aborted).toBe(true);
      // Hashing takes real event-loop turns, which fake time would outrun.
      vi.useRealTimers();
      await handle({ id: 1, statement: "S", authors: ["Ada"] });
      expect(last()).toHaveProperty("result");
    } finally {
      vi.useRealTimers();
    }
  });

  it("pins the real census/model.json to a commit, and every file the worker reads by size and sha256", async () => {
    const real = (await vi.importActual<{ default: typeof pins }>("../../census/model.json")).default;
    expect(real.revision).toMatch(/^[0-9a-f]{40}$/);
    for (const file of Object.keys(files)) {
      expect(real.sha256[file], file).toMatch(/^[0-9a-f]{64}$/);
      expect(real.bytes[file], file).toBeGreaterThan(0);
    }
  });

  it("refuses a truncated or changed JSON file, and caches none of it", async () => {
    const whole = files["tokenizer.json"] ?? "";
    files["tokenizer.json"] = whole.slice(0, -1);
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "tokenizer.json is not the file census/model.json pins." });
    expect(cached.has(`${BASE}tokenizer.json`)).toBe(false);
    files["tokenizer.json"] = whole;
    // The same length, other labels.
    files["config.json"] = JSON.stringify({ id2label: { 0: "validation", 1: "software" } });
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 1, error: "config.json is not the file census/model.json pins." });
    expect(cached.has(`${BASE}config.json`)).toBe(false);
  });

  it("refuses a best.json whose threshold is not a number", async () => {
    files["best.json"] = JSON.stringify({ threshold: "0.4" });
    pin("best.json");
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "best.json has no threshold." });
  });

  it("stops reading a model body once it runs past the pinned size", async () => {
    // One byte too many, and then the body stays open: a read to its end would wait for good.
    serveModel([new Uint8Array(MODEL.length + 1)], 0, true);
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toEqual({ id: 0, error: "onnx/model_w8.onnx is not the file census/model.json pins." });
  });

  it("reads without the offline copy when the cache will not open", async () => {
    vi.stubGlobal("caches", { open: () => Promise.reject(new DOMException("blocked", "SecurityError")) });
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
  });

  it("deletes an earlier pin's files from the cache once the model loads", async () => {
    const stale = `https://huggingface.co/${pins.repo}/resolve/${"f".repeat(40)}/onnx/model_w8.onnx`;
    cached.set(stale, new Response("an earlier model"));
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
    expect([...cached.keys()].sort()).toEqual(
      Object.keys(files)
        .map((f) => BASE + f)
        .sort(),
    );
    // An old tab still on the transformers.js reader can write its cache again after public/sw.js deleted it.
    expect(dropped).toEqual(["transformers-cache"]);
  });

  it("keeps a local export's files, whose base is a path on this site", async () => {
    const base = "/reader-model/0123/";
    pins.base = base;
    vi.mocked(fetch).mockImplementation(async (url) => new Response(files[String(url).slice(base.length)]));
    await start();
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(last()).toHaveProperty("result");
    expect(cached.size).toBe(4);
  });

  it("keeps a slow download that sends a piece every 40 seconds", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      serveModel(
        [...MODEL].map((b) => Uint8Array.of(b)),
        40_000,
      );
      let done = false;
      void handle({ id: 0, statement: "S", authors: ["Ada"] }).then(() => {
        done = true;
      });
      // The stream and the hash take real event-loop turns before each next timer exists, so the
      // clock moves a second at a time with a real turn between: a jump would pass timers set later.
      while (!done) {
        await vi.advanceTimersByTimeAsync(1_000);
        await new Promise((resolve) => setImmediate(resolve));
      }
      expect(last()).toHaveProperty("result");
      const percents = replies.flatMap((r) =>
        "progress" in r && r.progress.phase === "download" ? [r.progress.percent] : [],
      );
      expect(percents).toEqual([25, 50, 75, 100]);
    } finally {
      vi.useRealTimers();
    }
  });
});
