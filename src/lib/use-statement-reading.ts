import { useEffect, useRef, useState } from "react";
import { type ReaderProgress, type ReaderResult, readStatement } from "./statement-reader";

export type ModelReading =
  | { status: "loading"; progress?: ReaderProgress }
  | { status: "done"; result: ReaderResult }
  | { status: "failed" };

/**
 * The model's reading of `statement` for `names` (byline order), started by `read`. A reading belongs to
 * that statement and roster only: changing either, or passing `null`, stops it and hides it.
 */
export function useStatementReading(statement: string | null, names: readonly string[]) {
  const key = statement === null ? null : JSON.stringify([statement, names]);
  const [state, setState] = useState<{ key: string; reading: ModelReading } | null>(null);
  const abort = useRef<AbortController | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per key, to stop the last key's reading.
  useEffect(() => () => abort.current?.abort(), [key]);

  async function read() {
    if (statement === null || key === null) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const set = (reading: ModelReading | null) =>
      setState((last) => (reading ? { key, reading } : last?.key === key ? null : last));
    set({ status: "loading" });
    try {
      const result = await readStatement(
        statement,
        names,
        (progress) => {
          if (!controller.signal.aborted) set({ status: "loading", progress });
        },
        controller.signal,
      );
      set({ status: "done", result });
    } catch {
      if (!controller.signal.aborted) set({ status: "failed" });
      // Stopped by a new statement or roster, not by a newer read: forget it, so it can be read again.
      else if (abort.current === controller) set(null);
    }
  }

  return { reading: state?.key === key ? state.reading : null, read };
}
