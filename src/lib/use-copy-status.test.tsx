import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntlProvider } from "@/lib/translations";
import { messages as en } from "@/locales/en/messages";
import { announce } from "./announce";
import { useCopyStatus } from "./use-copy-status";

vi.mock("./announce", () => ({ announce: vi.fn() }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <IntlProvider locale="en" messages={en}>
      {children}
    </IntlProvider>
  );
}

/** The clipboard jsdom does not implement; resolves unless told to reject. */
function stubClipboard(writeText: (text: string) => Promise<void>) {
  const spy = vi.fn(writeText);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: spy }, configurable: true });
  return spy;
}

beforeEach(() => {
  vi.useFakeTimers();
  stubClipboard(() => Promise.resolve());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useCopyStatus", () => {
  it("writes text, reports success, and returns to idle after the window", async () => {
    const writeText = stubClipboard(() => Promise.resolve());
    const { result } = renderHook(() => useCopyStatus(), { wrapper });

    expect(result.current[0]).toBe("idle");
    await act(async () => {
      expect(await result.current[1]("CRediT: Grace Hopper")).toBe(true);
    });

    expect(writeText).toHaveBeenCalledWith("CRediT: Grace Hopper");
    expect(result.current[0]).toBe("copied");
    expect(announce).toHaveBeenCalledWith("Copied to clipboard");

    act(() => vi.advanceTimersByTime(2000));
    expect(result.current[0]).toBe("idle");
  });

  it("runs a caller's own write, for the blob the heatmap copies", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCopyStatus({ copied: "Image copied" }), { wrapper });

    await act(async () => {
      expect(await result.current[1](write)).toBe(true);
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toBe("copied");
    expect(announce).toHaveBeenCalledWith("Image copied");
  });

  it("reports a refused write as an error, announced assertively", async () => {
    stubClipboard(() => Promise.reject(new Error("denied")));
    const { result } = renderHook(() => useCopyStatus(), { wrapper });

    await act(async () => {
      expect(await result.current[1]("CRediT: Grace Hopper")).toBe(false);
    });

    expect(result.current[0]).toBe("error");
    expect(announce).toHaveBeenCalledWith("Copy failed. Try again.", { assertive: true });
  });

  it("restarts the window on a second copy, so a quick pair does not clear early", async () => {
    const { result } = renderHook(() => useCopyStatus(), { wrapper });

    await act(async () => {
      await result.current[1]("first");
    });
    act(() => vi.advanceTimersByTime(1500));
    await act(async () => {
      await result.current[1]("second");
    });

    // The first copy's reset would have fired here; the second pushed it back.
    act(() => vi.advanceTimersByTime(1500));
    expect(result.current[0]).toBe("copied");

    act(() => vi.advanceTimersByTime(500));
    expect(result.current[0]).toBe("idle");
  });

  it("drops a pending reset on unmount rather than setting state on a dead component", async () => {
    const { result, unmount } = renderHook(() => useCopyStatus(), { wrapper });

    await act(async () => {
      await result.current[1]("text");
    });
    unmount();

    expect(() => vi.advanceTimersByTime(2000)).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });
});
