/// <reference lib="webworker" />
// The census model (census/MODEL_CARD.md) in the browser: int8 ONNX through transformers.js on
// onnxruntime-web's CPU build. Loaded on the first request, then kept for the page's life.
import { AutoModelForSequenceClassification, AutoTokenizer, env, Tensor } from "@huggingface/transformers";
import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import shipped from "../../census/model.json";
import type { ReaderReply, ReaderRequest } from "./statement-reader";
import { MAX_TOKENS } from "./statement-reader";

// The commit, not the tag: a tag can be moved without an app release.
const { repo, revision } = shipped;
env.allowLocalModels = false;
// The runtime is served from this site: the CSP allows no script from a CDN. Not via
// transformers.js's own WASM cache, which imports the glue from a blob: URL the CSP refuses.
env.useWasmCache = false;
const onnx = env.backends.onnx as { wasm: { wasmPaths: unknown; numThreads: number } };
onnx.wasm.wasmPaths = { wasm };
// Threads need SharedArrayBuffer, so cross-origin isolation (public/_headers); Safari ignores
// COEP: credentialless and gets one. Past four, a 68M model gains little.
onnx.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
/** A download that sends nothing for this long has stalled: fail, so the next request starts over. */
export const STALL_MS = 60_000;

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
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fail!: (error: Error) => void;
  const stalled = new Promise<never>((_, reject) => {
    fail = reject;
  });
  const poke = () => {
    clearTimeout(timer);
    timer = setTimeout(() => fail(new Error("The model download stalled.")), STALL_MS);
  };
  poke();
  const loaded = Promise.all([
    AutoTokenizer.from_pretrained(repo, { revision }),
    AutoModelForSequenceClassification.from_pretrained(repo, {
      revision,
      dtype: "int8",
      device: "wasm",
      progress_callback: (info: { status: string; progress?: number }) => {
        poke();
        if (info.status === "progress_total") post({ progress: { phase: "download", percent: info.progress ?? 0 } });
      },
    }),
    fetchThreshold(),
  ]);
  try {
    const [tokenizer, model, threshold] = await Promise.race([loaded, stalled]);
    return { tokenizer, model, threshold };
  } finally {
    clearTimeout(timer);
  }
}

let loading: ReturnType<typeof load> | undefined;
const cancelled = new Set<number>();

async function onRequest({ data }: MessageEvent<ReaderRequest>) {
  if ("cancel" in data) {
    cancelled.add(data.cancel);
    return;
  }
  const { id, statement, authors } = data;
  try {
    loading ??= load();
    // A failed load (offline, quota) is retried on the next request.
    const { tokenizer, model, threshold } = await loading.catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    const probabilities: number[][] = [];
    for (const [i, text] of authors.entries()) {
      // A cancel waits in the task queue behind this loop's microtasks: let it in first.
      await new Promise((resolve) => setTimeout(resolve));
      if (cancelled.has(id)) return;
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
    post({ id, result: { probabilities, labels, threshold } });
  } catch (error) {
    post({ id, error: error instanceof Error ? error.message : String(error) });
  } finally {
    cancelled.delete(id);
  }
}

// onnxruntime-web starts its thread workers from this same script, named em-pthread, and listens on their
// onmessage itself: taking it over would leave each thread waiting for work forever.
if (!self.name.startsWith("em-pthread")) self.onmessage = onRequest;
