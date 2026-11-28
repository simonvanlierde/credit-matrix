import { useEffect } from "react";
import { create } from "zustand";

export interface CustomFigureFont {
  bytes: Uint8Array;
  family: string;
  file: string;
  warning?: string;
}

/** Font bytes stay outside drafts, share links and exported JSON. */
function storage(mode: IDBTransactionMode, font?: CustomFigureFont | null): Promise<CustomFigureFont | null> {
  return new Promise((resolve, reject) => {
    let blocked = false;
    const request = indexedDB.open("credit-matrix-figure-font", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("fonts");
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Font storage is blocked by another tab."));
    };
    request.onsuccess = () => {
      const db = request.result;
      if (blocked) {
        db.close();
        return;
      }
      db.onversionchange = () => db.close();
      const transaction = db.transaction("fonts", mode);
      const store = transaction.objectStore("fonts");
      const operation =
        mode === "readonly" ? store.get("custom") : font ? store.put(font, "custom") : store.delete("custom");
      transaction.oncomplete = () => {
        db.close();
        resolve(mode === "readonly" ? (operation.result ?? null) : (font ?? null));
      };
      transaction.onabort = () => {
        db.close();
        reject(transaction.error ?? new Error("Font storage failed."));
      };
    };
  });
}

const useFontStore = create<{
  font: CustomFigureFont | null;
  busy: boolean;
  ready: boolean;
  error: "load" | "save" | "font" | null;
  detail: string;
}>(() => ({ font: null, busy: false, ready: false, error: null, detail: "" }));
let hydrated: Promise<void> | undefined;

export function useCustomFigureFont() {
  const state = useFontStore();
  useEffect(() => {
    hydrated ??= storage("readonly").then(
      (font) => useFontStore.setState({ font, ready: true }),
      () => useFontStore.setState({ error: "load", ready: true }),
    );
  }, []);
  return state;
}

export async function selectFigureFont(file: File | null) {
  if (useFontStore.getState().busy) return;
  useFontStore.setState({ busy: true, error: null, detail: "" });
  try {
    await hydrated;
    let font: CustomFigureFont | null = null;
    if (file) {
      if (file.size > 32 * 1024 * 1024) throw new Error("Choose a font smaller than 32 MiB.");
      const bytes = new Uint8Array(await file.arrayBuffer());
      const { inspectFigureFont } = await import("@/core/figures");
      const found = await inspectFigureFont(bytes, file.name);
      font = { bytes, family: found.family, file: file.name, warning: found.warning };
    }
    try {
      await storage("readwrite", font);
    } catch {
      useFontStore.setState({ error: "save" });
      return;
    }
    useFontStore.setState({ font });
  } catch (cause) {
    useFontStore.setState({ error: "font", detail: cause instanceof Error ? cause.message : "" });
  } finally {
    useFontStore.setState({ busy: false });
  }
}
