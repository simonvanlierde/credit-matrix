import { afterEach, expect, it, vi } from "vitest";
import { ConverterUnavailableError, convertCitation } from "./citation-import";

let instance: {
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  terminate: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
};
const Worker = vi.fn(function (this: object) {
  Object.assign(this, {});
  instance = { onmessage: null, onerror: null, terminate: vi.fn(), postMessage: vi.fn() };
  return instance;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("starts a lazy same-origin worker, sends input locally and frees the runtime", async () => {
  vi.stubGlobal("Worker", Worker);
  const result = convertCitation("cff-version: 1.2.0", "cff");
  expect(Worker).toHaveBeenCalledWith("/citesync-worker.js", { type: "module" });
  expect(instance.postMessage).toHaveBeenCalledWith({ filename: "CITATION.cff", text: "cff-version: 1.2.0" });
  instance.onmessage?.({ data: { codemeta: "{}" } });
  await expect(result).resolves.toBe("{}");
  expect(instance.terminate).toHaveBeenCalledOnce();
});

it.each(["error", "malformed", "network", "timeout"])("rejects %s failures and terminates", async (failure) => {
  vi.useFakeTimers();
  vi.stubGlobal("Worker", Worker);
  const promise = convertCitation("{}", "zenodo");
  const checked = expect(promise).rejects.toThrow();
  if (failure === "network") instance.onerror?.();
  else if (failure === "timeout") await vi.advanceTimersByTimeAsync(120_000);
  else instance.onmessage?.({ data: failure === "error" ? { error: "Bad file" } : {} });
  await checked;
  expect(instance.terminate).toHaveBeenCalledOnce();
});

it.each([
  ["a runtime that never loaded", { error: "The converter build is missing.", unavailable: true }, true],
  ["a file the converter rejects", { error: "Bad CFF", unavailable: false }, false],
])("marks %s as unavailable only when it is", async (_, data, unavailable) => {
  vi.stubGlobal("Worker", Worker);
  const result = convertCitation("{}", "cff");
  instance.onmessage?.({ data });
  const failure = await result.catch((error: unknown) => error);
  expect(failure instanceof ConverterUnavailableError).toBe(unavailable);
});

it("terminates the worker when the signal aborts, and never starts one for a spent signal", async () => {
  vi.stubGlobal("Worker", Worker);
  const controller = new AbortController();
  const result = convertCitation("{}", "zenodo", controller.signal);
  const checked = expect(result).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await checked;
  expect(instance.terminate).toHaveBeenCalledOnce();

  Worker.mockClear();
  await expect(convertCitation("{}", "zenodo", controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(Worker).not.toHaveBeenCalled();
});
