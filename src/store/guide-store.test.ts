import { beforeEach, expect, it } from "vitest";
import { useGuide } from "./guide-store";

const KEY = "credit-matrix-guide";
const stored = () => JSON.parse(localStorage.getItem(KEY) ?? "null")?.state;

beforeEach(() => {
  localStorage.clear();
  useGuide.setState({ copied: false, dismissed: false });
  localStorage.clear();
});

it("keeps a dismissal saved before this tab read storage when a copy is marked", () => {
  localStorage.setItem(KEY, JSON.stringify({ state: { copied: false, dismissed: true }, version: 0 }));
  useGuide.getState().markCopied();
  expect(stored()).toEqual({ copied: true, dismissed: true });
});

it("keeps a copy another tab saved when the checklist is closed here", () => {
  localStorage.setItem(KEY, JSON.stringify({ state: { copied: true, dismissed: false }, version: 0 }));
  useGuide.getState().dismiss();
  expect(stored()).toEqual({ copied: true, dismissed: true });
});
