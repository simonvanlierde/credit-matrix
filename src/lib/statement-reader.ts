// The census model, which reads statements in authors' own words as well as CRediT names. It runs in a
// worker (statement-reader.worker.ts) that loads only when someone asks for it, never at install.
import { CREDIT_ROLES, type CreditRoleName } from "@/core";
import { creditSlug } from "@/core/credit-roles";
import shipped from "../../census/model.json";

/** The model file the worker downloads, a key of census/model.json's `sha256` and `bytes`. */
export const MODEL_FILE = "onnx/model_w8.onnx";
/** Its size in bytes, for the download notice; scripts/check-bundle-size.mjs caps it. */
export const MODEL_BYTES = shipped.bytes[MODEL_FILE];
/** Training's max length (run.json `max_length`): the most tokens one chunk holds. */
export const MAX_TOKENS = 1024;
/** The token before each author's text, as `onepass.MARKER` in census/src/census/onepass.py. */
export const MARKER = "[unused0]";
// On gold500b (the dev set), read in one pass in w8, a pair at 0.2 to 0.7 was in the gold 22% to 66% of
// the time; below it at most 13%, above it at least 71%. About 1.8 such pairs per article.
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

/** An author as the model reads them, after a marker, as `encoder.author_text`. */
export function authorText(name: string, position: number, of: number): string {
  return `${name} (${initials(name).join(", ")}); author ${position} of ${of}`;
}

/** One input of the model: some of the byline's authors (indexes from 0), each marked, then the statement. */
export interface Chunk {
  authors: number[];
  ids: number[];
  /** Where each author's marker sits in `ids`: the model gives one row of logits per marker. */
  markers: number[];
}

/**
 * How many statement tokens a chunk keeps, as `onepass.statement_room`: all that fit beside the whole
 * byline, but at least `maxLength` less a quarter for authors (or the longest author, if longer).
 */
export function statementRoom(authors: number[][], maxLength = MAX_TOKENS): number {
  const lengths = authors.map((a) => 1 + Math.min(a.length, Math.floor(maxLength / 4)));
  const byline = lengths.reduce((sum, n) => sum + n, 0);
  return maxLength - 3 - Math.min(byline, Math.max(...lengths, Math.floor(maxLength / 4)));
}

/**
 * The model's inputs for one statement, as `onepass.chunks`: `[CLS] <m> author ... [SEP] statement [SEP]`
 * with as many authors per chunk as fit, so a long byline repeats the statement in each. An author is cut
 * at a quarter of `maxLength` and the statement to `statementRoom`, so every chunk holds one author at least.
 */
export function chunks(
  authors: number[][],
  statement: number[],
  { cls, sep, marker }: { cls: number; sep: number; marker: number },
  maxLength = MAX_TOKENS,
): Chunk[] {
  if (authors.length === 0) return [];
  const kept = statement.slice(0, statementRoom(authors, maxLength));
  const cut = authors.map((a) => a.slice(0, Math.floor(maxLength / 4)));
  const room = maxLength - 3 - kept.length;
  const groups: number[][] = [[]];
  let used = 0;
  cut.forEach((a, i) => {
    if ((groups.at(-1)?.length ?? 0) > 0 && used + 1 + a.length > room) {
      groups.push([]);
      used = 0;
    }
    groups.at(-1)?.push(i);
    used += 1 + a.length;
  });
  return groups.map((group) => {
    const ids = [cls];
    const markers: number[] = [];
    for (const i of group) {
      markers.push(ids.length);
      ids.push(marker, ...(cut[i] ?? []));
    }
    return { authors: group, ids: [...ids, sep, ...kept, sep], markers };
  });
}

/**
 * A role for one author: `check` when the model gave it with a probability too close to the threshold to
 * trust, `doubt` when the rules found it and the model did not.
 */
export interface ReadRole {
  role: CreditRoleName;
  note?: "check" | "doubt";
}

const ROLE_BY_SLUG = new Map(CREDIT_ROLES.map((role) => [creditSlug(role.url), role.name]));

/**
 * Per author, the roles at or above the threshold (`check` inside the band) and, apart, the roles just
 * below it that may still be meant.
 */
export function decode({ probabilities, labels, threshold }: ReaderResult) {
  const byIndex = labels.map((slug) => ROLE_BY_SLUG.get(slug));
  return probabilities.map((row) => {
    const roles: ReadRole[] = [];
    const maybe: CreditRoleName[] = [];
    row.forEach((p, i) => {
      const role = byIndex[i];
      if (!role) return;
      if (p >= threshold) roles.push(p < CHECK_ABOVE ? { role, note: "check" } : { role });
      else if (p >= CHECK_BELOW) maybe.push(role);
    });
    return { roles, maybe };
  });
}

/** One author's roles from the rules, checked against the model's reading when there is one. */
export interface AuthorReading {
  roles: ReadRole[];
  /** Roles the model found and the rules did not, offered but not added. */
  suggested: CreditRoleName[];
  /** Roles the model nearly gave, listed when its reading stands alone. */
  maybe: CreditRoleName[];
}

/**
 * Per author, the rules' roles (`rules`, byline order) and what the model's reading changes: a role the
 * rules found and the model did not is a `doubt`, one only the model found is `suggested`. When the rules
 * read no role at all (`rulesRead` false; prose: "A.B. designed the study"), the model's reading stands alone,
 * close calls marked `check`. A caller whose rules read roles for a token no author matched yet passes true,
 * so naming who the token means cannot switch the reading the review shows. On test200b's CRediT statements the rules' roles were right 98% of the time but found
 * only 77% of the gold ones, and the model scored F1 0.97: it questions the rules, and offers what it adds.
 */
export function combine(
  rules: CreditRoleName[][],
  result?: ReaderResult,
  rulesRead = rules.some((roles) => roles.length > 0),
): AuthorReading[] {
  const model = result && decode(result);
  if (model && !rulesRead) {
    return model.map(({ roles, maybe }) => ({ roles, suggested: [], maybe }));
  }
  return rules.map((mine, i) => {
    const found = model && new Set(model[i]?.roles.map((r) => r.role));
    return {
      roles: mine.map((role) => (found && !found.has(role) ? { role, note: "doubt" } : { role })),
      suggested: [...(found ?? [])].filter((role) => !mine.includes(role)),
      maybe: [],
    };
  });
}

let worker: Worker | undefined;
let nextId = 0;

/**
 * Read `statement` for each author (full names, in byline order). The first call downloads the model
 * (`MODEL_BYTES`, then cached by the browser); later calls reuse it. Aborting stops after the current chunk.
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
