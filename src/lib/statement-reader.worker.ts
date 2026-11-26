/// <reference lib="webworker" />
// The census model (census/MODEL_CARD.md) in the browser: int8 ONNX through transformers.js on
// onnxruntime-web's CPU build. Loaded on the first request, then kept for the page's life.
import { AutoModelForSequenceClassification, AutoTokenizer, env, Tensor } from "@huggingface/transformers";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import shipped from "../../census/model.json";
import type { ReaderReply, ReaderRequest } from "./statement-reader";
import { MAX_TOKENS } from "./statement-reader";

const { repo, run: revision } = shipped;
env.allowLocalModels = false;
// The runtime is served from this site: the CSP allows no script from a CDN. Not via
// transformers.js's own WASM cache, which imports the glue from a blob: URL the CSP refuses.
env.useWasmCache = false;
const onnx = env.backends.onnx as { wasm: { wasmPaths: unknown; numThreads: number } };
onnx.wasm.wasmPaths = { wasm };
// NOTE: one thread; more need cross-origin isolation (COEP), which this site does not set.
onnx.wasm.numThreads = 1;

const post = (reply: ReaderReply) => self.postMessage(reply);

/** best.json beside the weights: the threshold the config does not hold. Cached for offline use. */
async function fetchThreshold(): Promise<number> {
  const url = `${env.remoteHost}${repo}/resolve/${revision}/best.json`;
  const cache = await caches.open(env.cacheKey);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (!response.ok) throw new Error(`best.json: HTTP ${response.status}`);
    await cache.put(url, response.clone());
  }
  return ((await response.json()) as { threshold: number }).threshold;
}

async function load() {
  const [tokenizer, model, threshold] = await Promise.all([
    AutoTokenizer.from_pretrained(repo, { revision }),
    AutoModelForSequenceClassification.from_pretrained(repo, {
      revision,
      dtype: "int8",
      device: "wasm",
      progress_callback: (info: { status: string; progress?: number }) => {
        if (info.status === "progress_total") post({ progress: { phase: "download", percent: info.progress ?? 0 } });
      },
    }),
    fetchThreshold(),
  ]);
  return { tokenizer, model, threshold };
}

let loading: ReturnType<typeof load> | undefined;
let cancelled = -1;

self.onmessage = async ({ data }: MessageEvent<ReaderRequest>) => {
  if ("cancel" in data) {
    cancelled = data.cancel;
    return;
  }
  const { id, statement, authors } = data;
  try {
    const waited = performance.now();
    loading ??= load();
    // A failed load (offline, quota) is retried on the next request.
    const { tokenizer, model, threshold } = await loading.catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    const started = performance.now();
    const loadMs = started - waited;
    const probabilities: number[][] = [];
    for (const [i, text] of authors.entries()) {
      if (cancelled === id) return;
      post({ id, progress: { phase: "read", done: i, of: authors.length } });
      const encoded = tokenizer(text, { text_pair: statement, return_tensor: false }) as { input_ids: number[] };
      let ids = encoded.input_ids;
      // Training cut the statement, never the author text, and kept the closing [SEP] ("only_second").
      if (ids.length > MAX_TOKENS) ids = [...ids.slice(0, MAX_TOKENS - 1), ids.at(-1) ?? 0];
      const shape = [1, ids.length];
      const { logits } = (await model({
        input_ids: new Tensor("int64", BigInt64Array.from(ids, BigInt), shape),
        attention_mask: new Tensor("int64", new BigInt64Array(ids.length).fill(1n), shape),
      })) as { logits: Tensor };
      probabilities.push(Array.from(logits.data as Float32Array, (x) => 1 / (1 + Math.exp(-x))));
    }
    const id2label = (model.config as unknown as { id2label: Record<string, string> }).id2label;
    const labels = Object.keys(id2label).map((i) => id2label[i] ?? "");
    post({ id, result: { probabilities, labels, threshold, loadMs, readMs: performance.now() - started } });
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
