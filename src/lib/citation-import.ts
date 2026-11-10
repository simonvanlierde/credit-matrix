/** The converter could not load or answer (offline, missing files, timeout); the file itself may be fine. */
export class ConverterUnavailableError extends Error {
  override name = "ConverterUnavailableError";
}

function cancelled(): Error {
  return Object.assign(new Error("The conversion was cancelled."), { name: "AbortError" });
}

/** Run citesync only for a citation-file import; terminate its runtime after the response. */
export function convertCitation(text: string, format: "cff" | "zenodo", signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(cancelled());
    const worker = new Worker("/citesync-worker.js", { type: "module" });
    const timeout = setTimeout(
      () => finish(new ConverterUnavailableError("The citation converter timed out.")),
      120_000,
    );
    function finish(result: string | Error) {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      worker.terminate();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    const onAbort = () => finish(cancelled());
    signal?.addEventListener("abort", onAbort);
    worker.onmessage = ({ data }: MessageEvent<{ codemeta?: string; error?: string; unavailable?: boolean }>) => {
      if (typeof data.codemeta === "string") return finish(data.codemeta);
      const message = data.error || "Conversion failed.";
      finish(data.unavailable ? new ConverterUnavailableError(message) : new Error(message));
    };
    worker.onerror = () => finish(new ConverterUnavailableError("The citation converter could not load."));
    worker.postMessage({ filename: format === "cff" ? "CITATION.cff" : ".zenodo.json", text });
  });
}
