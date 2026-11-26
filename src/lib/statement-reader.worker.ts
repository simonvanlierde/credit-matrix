/// <reference lib="webworker" />
// The census model (census/MODEL_CARD.md) in the browser: the one-pass graph, 8-bit weights, on
// onnxruntime-web's CPU build. Loaded on the first request, then kept for the page's life.

import wasm from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { env, InferenceSession, Tensor } from "onnxruntime-web/wasm";
import shipped from "../../census/model.json";
import type { ReaderReply, ReaderRequest } from "./statement-reader";
import { chunks, MARKER, MODEL_FILE } from "./statement-reader";
import { type TokenizerJson, tokenizer } from "./tokenizer";

// The commit, not the tag: a tag can be moved without an app release. `base` is set only by vite.config.mts's
// READER_MODEL_DIR, which serves a local export in place of the Hub.
const {
  repo,
  revision,
  base = `https://huggingface.co/${repo}/resolve/${revision}/`,
  ...pinned
} = shipped as typeof shipped & { base?: string };
const sha256: Record<string, string | undefined> = pinned.sha256;
const bytes: Record<string, number | undefined> = pinned.bytes;
/** The Cache Storage entry for the model's files, which public/sw.js leaves alone. */
export const CACHE = "statement-reader";
// The runtime is served from this site: the CSP allows no script from a CDN.
env.wasm.wasmPaths = { wasm };
// Threads need SharedArrayBuffer, so cross-origin isolation (public/_headers); Safari ignores
// COEP: credentialless and gets one. Past four, a 68M model gains little.
env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
/** A download that sends nothing for this long has stalled: fail, so the next request starts over. */
export const STALL_MS = 60_000;

const post = (reply: ReaderReply) => self.postMessage(reply);
const hex = (buffer: ArrayBuffer) =>
  Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");

/** The offline copy, or none where storage is blocked (some private windows): the reader works without it. */
async function openCache(): Promise<Cache | undefined> {
  try {
    return await caches.open(CACHE);
  } catch {
    return undefined;
  }
}

/**
 * A file of the pinned export, from the cache or else the Hub, where it must have the size and sha256
 * census/model.json pins before it is cached; `onChunk` hears each piece downloaded.
 */
async function download(
  file: string,
  cache: Cache | undefined,
  signal: AbortSignal,
  onChunk: (bytes: number) => void,
): Promise<ArrayBuffer> {
  const url = base + file;
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const [want, size] = [sha256[file], bytes[file]];
  if (!(want && size)) throw new Error(`census/model.json pins no ${file}.`);
  const refused = new Error(`${file} is not the file census/model.json pins.`);
  const response = await fetch(url, { signal });
  if (!(response.ok && response.body)) throw new Error(`${file}: HTTP ${response.status}`);
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let received = 0;
  const reader = response.body.getReader();
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    received += read.value.length;
    // Not buffered past the pinned size; load() aborts the fetch.
    if (received > size) throw refused;
    parts.push(read.value);
    onChunk(read.value.length);
  }
  const body = await new Blob(parts).arrayBuffer();
  if (body.byteLength !== size || hex(await crypto.subtle.digest("SHA-256", body)) !== want) throw refused;
  // A load that failed meanwhile caches nothing more.
  signal.throwIfAborted();
  // Out of space: read without the offline copy.
  await cache?.put(url, new Response(body)).catch(() => undefined);
  return body;
}

async function load() {
  const controller = new AbortController();
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
  let received = 0;
  const cache = await openCache();
  const json = async <T>(file: string) =>
    JSON.parse(new TextDecoder().decode(await download(file, cache, controller.signal, poke))) as T;
  const loaded = Promise.all([
    json<TokenizerJson>("tokenizer.json"),
    json<{ id2label: Record<string, string> }>("config.json"),
    json<{ threshold: number }>("best.json"),
    download(MODEL_FILE, cache, controller.signal, (n) => {
      poke();
      received += n;
      post({ progress: { phase: "download", percent: Math.min(100, (100 * received) / (bytes[MODEL_FILE] ?? 1)) } });
    }).then((model) => InferenceSession.create(new Uint8Array(model), { executionProviders: ["wasm"] })),
  ]);
  try {
    const [vocabulary, { id2label }, { threshold }, session] = await Promise.race([loaded, stalled]);
    if (typeof threshold !== "number") throw new Error("best.json has no threshold.");
    const tokens = tokenizer(vocabulary);
    const special = (token: string) => {
      const id = tokens.id(token);
      if (id === undefined) throw new Error(`tokenizer.json has no ${token}.`);
      return id;
    };
    const ids = { cls: special("[CLS]"), sep: special("[SEP]"), marker: special(MARKER) };
    const labels = Object.keys(id2label).map((i) => id2label[i] ?? "");
    // An earlier release's files (75 MB a model) under another commit's `base`: no request reads them again.
    // Cached URLs are absolute, and a local export's `base` is a path.
    const current = new URL(base, self.location.href).href;
    const stale = (await cache?.keys().catch(() => [])) ?? [];
    await Promise.all(stale.filter(({ url }) => !url.startsWith(current)).map((r) => cache?.delete(r))).catch(
      () => undefined,
    );
    return { encode: tokens.encode, ids, session, labels, threshold };
  } finally {
    clearTimeout(timer);
    // After a stall or a failed file, the other downloads stop too.
    controller.abort();
  }
}

let loading: ReturnType<typeof load> | undefined;
const cancelled = new Set<number>();
const int64 = (values: number[]) => new Tensor("int64", BigInt64Array.from(values, BigInt), [1, values.length]);

async function onRequest({ data }: MessageEvent<ReaderRequest>) {
  if ("cancel" in data) {
    cancelled.add(data.cancel);
    return;
  }
  const { id, statement, authors } = data;
  try {
    loading ??= load();
    // A failed load (offline, quota) is retried on the next request.
    const { encode, ids, session, labels, threshold } = await loading.catch((error: unknown) => {
      loading = undefined;
      throw error;
    });
    const probabilities: number[][] = authors.map(() => []);
    let done = 0;
    for (const chunk of chunks(authors.map(encode), encode(statement), ids)) {
      // A cancel waits in the task queue behind this loop's microtasks: let it in first.
      await new Promise((resolve) => setTimeout(resolve));
      if (cancelled.has(id)) return;
      post({ id, progress: { phase: "read", done, of: authors.length } });
      const { logits } = await session.run({
        input_ids: int64(chunk.ids),
        attention_mask: int64(chunk.ids.map(() => 1)),
        marker_positions: int64(chunk.markers),
      });
      // logits [1, authors in the chunk, labels]
      const rows = logits?.data as Float32Array;
      chunk.authors.forEach((author, k) => {
        const row = rows.subarray(k * labels.length, (k + 1) * labels.length);
        probabilities[author] = Array.from(row, (x) => 1 / (1 + Math.exp(-x)));
      });
      done += chunk.authors.length;
    }
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
