import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { IDBDatabase, IDBFactory, IDBVersionChangeEvent } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const inspect = vi.hoisted(() => vi.fn());
vi.mock("@/core/figures", () => ({ inspectFigureFont: inspect }));

type FontModule = typeof import("./custom-figure-font");
let module: FontModule;

function file(name = "regular.ttf") {
  const value = new File([new Uint8Array([1, 2, 3])], name);
  Object.defineProperty(value, "arrayBuffer", { value: async () => new Uint8Array([1, 2, 3]).buffer });
  return value;
}

async function mount() {
  const hook = renderHook(() => module.useCustomFigureFont());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

beforeEach(async () => {
  vi.resetModules();
  vi.stubGlobal("indexedDB", new IDBFactory());
  inspect.mockReset().mockResolvedValue({ family: "Figure Test", warning: "Check embedding permission." });
  module = await import("./custom-figure-font");
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("custom figure font storage", () => {
  it("hydrates once, saves bytes and permission warnings, and restores them after a fresh mount", async () => {
    const first = await mount();
    expect(first.result.current.font).toBeNull();
    const open = vi.spyOn(indexedDB, "open");
    const second = await mount();
    expect(open).not.toHaveBeenCalled();
    await act(() => module.selectFigureFont(file()));
    expect(inspect).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]), "regular.ttf");
    const saved = first.result.current.font;
    expect(saved).toEqual({
      bytes: new Uint8Array([1, 2, 3]),
      family: "Figure Test",
      file: "regular.ttf",
      warning: "Check embedding permission.",
    });
    expect(second.result.current.font).toEqual(saved);
    first.unmount();
    second.unmount();
    vi.resetModules();
    module = await import("./custom-figure-font");
    const restored = await mount();
    expect({ ...restored.result.current.font, bytes: undefined }).toEqual({ ...saved, bytes: undefined });
    expect(Array.from(restored.result.current.font?.bytes ?? [])).toEqual([1, 2, 3]);
    await act(() => module.selectFigureFont(null));
    expect(restored.result.current.font).toBeNull();
    restored.unmount();
    vi.resetModules();
    module = await import("./custom-figure-font");
    expect((await mount()).result.current.font).toBeNull();
  });

  it("keeps the current font after malformed or oversized files and allows a retry", async () => {
    const hook = await mount();
    await act(() => module.selectFigureFont(file()));
    const saved = hook.result.current.font;
    inspect.mockRejectedValueOnce(new Error("Malformed font directory."));
    await act(() => module.selectFigureFont(file("broken.ttf")));
    expect(hook.result.current).toMatchObject({
      font: saved,
      busy: false,
      error: "font",
      detail: "Malformed font directory.",
    });
    const oversized = file("large.ttf");
    Object.defineProperty(oversized, "size", { value: 32 * 1024 * 1024 + 1 });
    const calls = inspect.mock.calls.length;
    await act(() => module.selectFigureFont(oversized));
    expect(inspect).toHaveBeenCalledTimes(calls);
    expect(hook.result.current).toMatchObject({
      font: saved,
      error: "font",
      detail: "Choose a font smaller than 32 MiB.",
    });
    inspect.mockRejectedValueOnce("unreadable");
    await act(() => module.selectFigureFont(file()));
    expect(hook.result.current.detail).toBe("");
    await act(() => module.selectFigureFont(file("replacement.otf")));
    expect(hook.result.current).toMatchObject({ error: null, detail: "", busy: false });
    expect(hook.result.current.font?.file).toBe("replacement.otf");
  });

  it("ignores a concurrent selection or removal until the current save finishes", async () => {
    const hook = await mount();
    let finish!: (value: { family: string }) => void;
    inspect.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = module.selectFigureFont(file());
    });
    await waitFor(() => expect(inspect).toHaveBeenCalledTimes(1));
    expect(hook.result.current.busy).toBe(true);
    await act(async () => {
      await module.selectFigureFont(file("other.ttf"));
      await module.selectFigureFont(null);
    });
    expect(inspect).toHaveBeenCalledTimes(1);
    await act(async () => {
      finish({ family: "Figure Test" });
      await pending;
    });
    expect(hook.result.current).toMatchObject({ busy: false, error: null });
    expect(hook.result.current.font?.file).toBe("regular.ttf");
  });

  it("preserves the stored font when a write aborts, then retries successfully", async () => {
    const hook = await mount();
    await act(() => module.selectFigureFont(file()));
    const saved = hook.result.current.font;
    const transaction = IDBDatabase.prototype.transaction;
    const failure = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
      this: IDBDatabase,
      ...args
    ) {
      const result = transaction.apply(this, args);
      if (args[1] === "readwrite") queueMicrotask(() => result.abort());
      return result;
    });
    await act(() => module.selectFigureFont(file("replacement.ttf")));
    expect(hook.result.current).toMatchObject({ font: saved, busy: false, error: "save" });
    failure.mockRestore();
    hook.unmount();
    vi.resetModules();
    module = await import("./custom-figure-font");
    const restored = await mount();
    expect({ ...restored.result.current.font, bytes: undefined }).toEqual({ ...saved, bytes: undefined });
    expect(Array.from(restored.result.current.font?.bytes ?? [])).toEqual([1, 2, 3]);
    await act(() => module.selectFigureFont(null));
    expect(restored.result.current).toMatchObject({ font: null, error: null });
  });

  it.each(["error", "blocked"] as const)(
    "releases hydration after an IndexedDB %s and recovers on selection",
    async (event) => {
      const request = { error: new DOMException("Storage unavailable", "UnknownError") } as IDBOpenDBRequest;
      const failure = vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
        queueMicrotask(() => {
          if (event === "error") request.onerror?.call(request, new Event("error"));
          else request.onblocked?.call(request, new IDBVersionChangeEvent("blocked"));
        });
        return request;
      });
      const hook = await mount();
      expect(hook.result.current).toMatchObject({ ready: true, error: "load", font: null });
      failure.mockRestore();
      await act(() => module.selectFigureFont(file()));
      expect(hook.result.current).toMatchObject({ error: null, busy: false });
      expect(hook.result.current.font?.family).toBe("Figure Test");
    },
  );

  it("closes a blocked request that later opens without starting a stale transaction", async () => {
    const db = { close: vi.fn(), transaction: vi.fn() };
    const request = { result: db } as unknown as IDBOpenDBRequest;
    vi.spyOn(indexedDB, "open").mockImplementationOnce(() => {
      queueMicrotask(() => request.onblocked?.call(request, new IDBVersionChangeEvent("blocked")));
      return request;
    });
    await mount();
    request.onsuccess?.call(request, new Event("success"));
    expect(db.close).toHaveBeenCalledOnce();
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it("closes a connection on version change while a read transaction is open", async () => {
    const transaction = IDBDatabase.prototype.transaction;
    const close = vi.spyOn(IDBDatabase.prototype, "close");
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
      const result = transaction.apply(this, args);
      this.dispatchEvent(new IDBVersionChangeEvent("versionchange", { oldVersion: 1, newVersion: 2 }));
      return result;
    });
    await mount();
    expect(close).toHaveBeenCalled();
  });
});
