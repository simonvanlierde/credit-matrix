// The census model, which reads statements in authors' own words as well as CRediT names. It runs in a
// worker (statement-reader.worker.ts) that loads only when someone asks for it, never at install.
import { CREDIT_ROLES, type CreditRoleName } from "@/core";
import { creditSlug } from "@/core/credit-roles";
import shipped from "../../census/model.json";

/** The int8 ONNX file's size in bytes, for the download notice; scripts/check-bundle-size.mjs caps it. */
export const MODEL_BYTES = shipped.bytes["onnx/model_int8.onnx"];
/** Training's max length; longer inputs lose the statement's end. */
export const MAX_TOKENS = 1024;
// On gold500b (the dev set), read one author at a time in int8, a pair at 0.2 to 0.7 was in the gold
// 28% to 67% of the time; below it at most 17%, above it at least 74%. About 1.7 such pairs per article.
export const CHECK_BELOW = 0.2;
export const CHECK_ABOVE = 0.7;

export type ReaderRequest = { id: number; statement: string; authors: string[] } | { cancel: number };
export type ReaderProgress = { phase: "download"; percent: number } | { phase: "read"; done: number; of: number };
export interface ReaderResult {
  /** Per author in byline order, one probability per role in `labels`. */
  probabilities: number[][];
  /** The model config's id2label: CRediT role slugs ("data-curation"). */
  labels: string[];
  threshold: number;
  /** Time spent waiting for the model to load: the download, or a cached copy's start-up. */
  loadMs: number;
  readMs: number;
}
export type ReaderReply =
  | { id?: number; progress: ReaderProgress }
  | { id: number; result: ReaderResult }
  | { id: number; error: string };

/** The ways a statement may write a name's initials, as `encoder.initials` in census/src/census/encoder.py. */
export function initials(name: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const surname = words.pop();
  if (!surname) return [];
  const first = (s: string) => [...s][0] ?? "";
  const given = words.map((w) => w.split(/-+/).filter(Boolean).map(first));
  const dotted = `${given.map((g) => g.map((c) => `${c}.`).join("-")).join("")}${first(surname)}.`;
  const compact = given.flat().join("");
  return [...new Set([dotted, compact + first(surname), ...(compact ? [`${surname} ${compact}`] : [])])];
}

/** The first input of the pair the model reads, as `encoder.author_text`. */
export function authorText(name: string, position: number, of: number): string {
  return `${name} (${initials(name).join(", ")}); author ${position} of ${of}`;
}

/** A role the model gives an author; `check` when its probability is too close to the threshold to trust. */
export interface ReadRole {
  role: CreditRoleName;
  check: boolean;
}

const ROLE_BY_SLUG = new Map(CREDIT_ROLES.map((role) => [creditSlug(role.url), role.name]));

/**
 * Per author, the roles at or above the threshold (`check` inside the band) and, apart, the roles just
 * below it that may still be meant.
 */
export function decode({
  probabilities,
  labels,
  threshold,
}: Pick<ReaderResult, "probabilities" | "labels" | "threshold">) {
  const byIndex = labels.map((slug) => ROLE_BY_SLUG.get(slug));
  return probabilities.map((row) => {
    const roles: ReadRole[] = [];
    const maybe: CreditRoleName[] = [];
    row.forEach((p, i) => {
      const role = byIndex[i];
      if (!role) return;
      if (p >= threshold) roles.push({ role, check: p < CHECK_ABOVE });
      else if (p >= CHECK_BELOW) maybe.push(role);
    });
    return { roles, maybe };
  });
}

let worker: Worker | undefined;
let nextId = 0;

/**
 * Read `statement` for each author (full names, in byline order). The first call downloads the model
 * (`MODEL_BYTES`, then cached by the browser); later calls reuse it. Aborting stops after the current author.
 */
export function readStatement(
  statement: string,
  names: readonly string[],
  onProgress: (progress: ReaderProgress) => void,
  signal?: AbortSignal,
): Promise<ReaderResult> {
  worker ??= new Worker(new URL("./statement-reader.worker.ts", import.meta.url), {
    type: "module",
    name: "statement-reader",
  });
  const reader = worker;
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      reader.postMessage({ cancel: id } satisfies ReaderRequest);
      finish();
      reject(Object.assign(new Error("The reading was cancelled."), { name: "AbortError" }));
    };
    const onMessage = ({ data }: MessageEvent<ReaderReply>) => {
      if (data.id !== undefined && data.id !== id) return;
      if ("progress" in data) return onProgress(data.progress);
      finish();
      if ("result" in data) resolve(data.result);
      else reject(new Error(data.error));
    };
    // A worker that fails to start (a missing chunk offline) answers nothing: drop it so a retry starts over.
    const onError = () => {
      finish();
      worker = undefined;
      reader.terminate();
      reject(new Error("The statement reader could not start."));
    };
    function finish() {
      reader.removeEventListener("message", onMessage);
      reader.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    }
    if (signal?.aborted) return onAbort();
    reader.addEventListener("message", onMessage);
    reader.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    const authors = names.map((name, i) => authorText(name, i + 1, names.length));
    reader.postMessage({ id, statement, authors } satisfies ReaderRequest);
  });
}
