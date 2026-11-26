import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import shipped from "../../census/model.json";
import { MAX_TOKENS, type ReaderReply } from "./statement-reader";
import { STALL_MS } from "./statement-reader.worker";

const hub = vi.hoisted(() => ({
  tokenizer: vi.fn(),
  model: vi.fn(),
  loadModel: vi.fn(),
  env: {
    remoteHost: "https://huggingface.co/",
    cacheKey: "transformers-cache",
    backends: { onnx: { wasm: {} as Record<string, unknown> } },
  } as Record<string, unknown>,
}));
vi.mock("@huggingface/transformers", () => ({
  env: hub.env,
  AutoTokenizer: { from_pretrained: async () => hub.tokenizer },
  AutoModelForSequenceClassification: { from_pretrained: hub.loadModel },
  Tensor: class {
    constructor(
      readonly type: string,
      readonly data: BigInt64Array,
      readonly dims: number[],
    ) {}
  },
}));
vi.mock("onnxruntime-web/ort-wasm-simd-threaded.wasm?url", () => ({ default: "/assets/ort.wasm" }));

const replies: ReaderReply[] = [];
const cached = new Map<string, Response>();
let handle: (data: unknown) => Promise<void>;
const onnx = () => (hub.env.backends as { onnx: { wasm: Record<string, unknown> } }).onnx.wasm;

beforeEach(async () => {
  replies.length = 0;
  cached.clear();
  vi.stubGlobal("postMessage", (reply: ReaderReply) => replies.push(reply));
  vi.stubGlobal("caches", {
    open: async () => ({
      match: async (url: string) => cached.get(url)?.clone(),
      put: async (url: string, response: Response) => void cached.set(url, response),
    }),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ threshold: 0.4 })),
  );
  hub.tokenizer.mockReturnValue({ input_ids: [1, 5, 2, 7, 8, 2] });
  hub.model.mockResolvedValue({ logits: { data: Float32Array.from([0, 10]) } });
  Object.assign(hub.model, { config: { id2label: { 0: "software", 1: "validation" } } });
  hub.loadModel.mockImplementation((_repo, { progress_callback }) => {
    progress_callback({ status: "progress_total", progress: 50 });
    progress_callback({ status: "done" });
    return Promise.resolve(hub.model);
  });
  vi.resetModules();
  await import("./statement-reader.worker");
  handle = (data) => (self.onmessage as unknown as (e: { data: unknown }) => Promise<void>)({ data });
});

afterEach(() => vi.unstubAllGlobals());

describe("the statement reader worker", () => {
  it("runs on this site's CPU runtime, with no CDN and one thread unless cross-origin isolated", async () => {
    expect(hub.env.allowLocalModels).toBe(false);
    expect(hub.env.useWasmCache).toBe(false);
    expect(hub.env.backends).toEqual({ onnx: { wasm: { wasmPaths: { wasm: "/assets/ort.wasm" }, numThreads: 1 } } });
    vi.stubGlobal("crossOriginIsolated", true);
    for (const [cores, threads] of [
      [16, 4],
      [2, 2],
    ]) {
      vi.stubGlobal("navigator", { hardwareConcurrency: cores });
      vi.resetModules();
      await import("./statement-reader.worker");
      expect(onnx().numThreads).toBe(threads);
    }
  });

  it("leaves onnxruntime's thread workers, which load this same script, their own message handler", async () => {
    self.onmessage = null;
    vi.stubGlobal("name", "em-pthread-1");
    vi.resetModules();
    await import("./statement-reader.worker");
    expect(self.onmessage).toBeNull();
  });

  it("loads the commit model.json pins, not a tag that can move", () => {
    expect(shipped.revision).toMatch(/^[0-9a-f]{40}$/);
  });

  it("reads each author with the statement, and returns probabilities with the config's labels", async () => {
    await handle({ id: 3, statement: "S", authors: ["Ada", "Charles"] });
    expect(hub.loadModel.mock.calls[0]?.slice(0, 1)).toEqual(["simonvanlierde/credit-statement-reader"]);
    expect(hub.loadModel.mock.calls[0]?.[1]).toMatchObject({ revision: shipped.revision, dtype: "int8" });
    expect(hub.tokenizer.mock.calls).toEqual([
      ["Ada", { text_pair: "S", return_tensor: false }],
      ["Charles", { text_pair: "S", return_tensor: false }],
    ]);
    expect(replies[0]).toEqual({ progress: { phase: "download", percent: 50 } });
    expect(replies.filter((r) => "progress" in r && r.progress.phase === "read")).toHaveLength(2);
    const last = replies.at(-1);
    expect(last && "result" in last && last.result).toMatchObject({
      labels: ["software", "validation"],
      threshold: 0.4,
      probabilities: [
        [0.5, 1 / (1 + Math.exp(-10))],
        [0.5, 1 / (1 + Math.exp(-10))],
      ],
    });
  });

  it("cuts a long statement as training did, keeping the closing separator", async () => {
    hub.tokenizer.mockReturnValue({ input_ids: [1, ...Array(MAX_TOKENS + 50).fill(9), 2] });
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    const { input_ids, attention_mask } = hub.model.mock.calls[0]?.[0] ?? {};
    expect(input_ids.dims).toEqual([1, MAX_TOKENS]);
    expect([input_ids.data[0], input_ids.data[MAX_TOKENS - 2], input_ids.data[MAX_TOKENS - 1]]).toEqual([1n, 9n, 2n]);
    expect(attention_mask.data.every((x: bigint) => x === 1n)).toBe(true);
  });

  it("caches best.json and loads the model once", async () => {
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(hub.loadModel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect([...cached.keys()]).toEqual([
      `https://huggingface.co/simonvanlierde/credit-statement-reader/resolve/${shipped.revision}/best.json`,
    ]);
  });

  it("reports a failed load and tries again on the next request", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response("", { status: 503 }));
    await handle({ id: 0, statement: "S", authors: ["Ada"] });
    expect(replies.at(-1)).toEqual({ id: 0, error: "best.json: HTTP 503" });
    hub.loadModel.mockRejectedValueOnce("quota");
    await handle({ id: 1, statement: "S", authors: ["Ada"] });
    expect(replies.at(-1)).toEqual({ id: 1, error: "quota" });
    await handle({ id: 2, statement: "S", authors: ["Ada"] });
    expect(replies.at(-1)).toHaveProperty("result");
  });

  it("stops each cancelled request between authors, not only the last one cancelled", async () => {
    const cancelling = (id: number) => () => {
      void handle({ cancel: id });
      return Promise.resolve({ logits: { data: Float32Array.from([0, 0]) } });
    };
    hub.model.mockImplementationOnce(cancelling(4)).mockImplementationOnce(cancelling(5));
    await Promise.all([4, 5].map((id) => handle({ id, statement: "S", authors: ["Ada", "Charles"] })));
    expect(hub.model).toHaveBeenCalledTimes(2);
    expect(replies.some((r) => "result" in r || "error" in r)).toBe(false);
    await handle({ id: 6, statement: "S", authors: ["Ada"] });
    expect(replies.at(-1)).toHaveProperty("result");
  });

  it("gives up on a download that sends nothing for a minute, and starts over on the next request", async () => {
    vi.useFakeTimers();
    try {
      hub.loadModel.mockImplementationOnce(() => new Promise(() => undefined));
      const stalled = handle({ id: 0, statement: "S", authors: ["Ada"] });
      await vi.advanceTimersByTimeAsync(STALL_MS);
      await stalled;
      expect(replies.at(-1)).toEqual({ id: 0, error: "The model download stalled." });
      const next = handle({ id: 1, statement: "S", authors: ["Ada"] });
      await vi.runAllTimersAsync();
      await next;
      expect(replies.at(-1)).toHaveProperty("result");
    } finally {
      vi.useRealTimers();
    }
  });
});
