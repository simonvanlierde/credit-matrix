import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchUpstreamJson } from "../upstream-fetch";

describe("fetchUpstreamJson deadline", () => {
  afterEach(() => vi.useRealTimers());

  it("maps a hung fetch to unavailable once the 5 s deadline fires", async () => {
    vi.useFakeTimers();
    // AbortSignal.timeout runs on a native timer that fake timers cannot
    // reach, so rebuild it on the (faked) setTimeout.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
      return controller.signal;
    });
    // A hung upstream: only the abort signal ever settles the promise.
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );

    const pending = fetchUpstreamJson("https://example.test/x", fetcher);
    expect(AbortSignal.timeout).toHaveBeenCalledWith(5000);
    expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);

    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ kind: "unavailable" });
  });
});
