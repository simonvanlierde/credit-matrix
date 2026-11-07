/** Run citesync only for a citation-file import; terminate its runtime after the response. */
export function convertCitation(text: string, format: "cff" | "zenodo"): Promise<string> {
  return new Promise((resolve, reject) => {
    const worker = new Worker("/citesync-worker.js", { type: "module" });
    const timeout = setTimeout(() => finish(new Error("The citation converter timed out.")), 120_000);
    function finish(result: string | Error) {
      clearTimeout(timeout);
      worker.terminate();
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    worker.onmessage = ({ data }: MessageEvent<{ codemeta?: string; error?: string }>) => {
      finish(typeof data.codemeta === "string" ? data.codemeta : new Error(data.error || "Conversion failed."));
    };
    worker.onerror = () => finish(new Error("The citation converter could not load."));
    worker.postMessage({ filename: format === "cff" ? "CITATION.cff" : ".zenodo.json", text });
  });
}
