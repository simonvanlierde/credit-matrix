import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cast } from "@/core/__tests__/cast";
import { authorText, decode, initials } from "./statement-reader";

describe("initials", () => {
  // Expected values printed by census.encoder.initials, which built every training input.
  it.each([
    ["Na-Gyeong Ryu", ["N.-G.R.", "NGR", "Ryu NG"]],
    [cast.ada, ["A.L.", "AL", "Lovelace A"]],
    [cast.rosalind, ["R.E.F.", "REF", "Franklin RE"]],
    [cast.marie, ["M.S.", "MS", "Skłodowska-Curie M"]],
    [cast.antonie, ["A.v.L.", "AvL", "Leeuwenhoek Av"]],
    [cast.hua, ["H.L.", "HL", "Luogeng H"]],
    ["Plato", ["P.", "P"]],
    ["", []],
  ])("matches the census encoder for %j", (name, want) => {
    expect(initials(name)).toEqual(want);
  });

  it("writes the author text the model was trained on", () => {
    expect(authorText(cast.antonie, 2, 5)).toBe("Antonie van Leeuwenhoek (A.v.L., AvL, Leeuwenhoek Av); author 2 of 5");
  });
});

describe("decode", () => {
  const labels = ["conceptualization", "software", "validation", "not-a-role"];

  it("keeps roles at the threshold, marks close calls, and lists near misses apart", () => {
    const [ada, alan] = decode({
      labels,
      threshold: 0.4,
      probabilities: [
        [0.99, 0.4, 0.39, 0.99],
        [0.7, 0.2, 0.19, 0],
      ],
    });
    expect(ada).toEqual({
      roles: [
        { role: "Conceptualization", check: false },
        { role: "Software", check: true },
      ],
      maybe: ["Validation"],
    });
    expect(alan).toEqual({ roles: [{ role: "Conceptualization", check: false }], maybe: ["Software"] });
  });
});

class FakeWorker extends EventTarget {
  static made: FakeWorker[] = [];
  posted: unknown[] = [];
  terminate = vi.fn();
  constructor() {
    super();
    FakeWorker.made.push(this);
  }
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  reply(data: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }
}

let reader: typeof import("./statement-reader");
beforeEach(async () => {
  FakeWorker.made = [];
  vi.stubGlobal("Worker", FakeWorker);
  vi.resetModules();
  reader = await import("./statement-reader");
});
afterEach(() => vi.unstubAllGlobals());

const RESULT = { probabilities: [[0.9]], labels: ["software"], threshold: 0.4, loadMs: 1, readMs: 2 };

describe("readStatement", () => {
  it("sends the author texts, passes progress on, and ignores other requests' replies", async () => {
    const onProgress = vi.fn();
    const pending = reader.readStatement("A.L. wrote the code.", ["Ada Lovelace"], onProgress);
    const [worker] = FakeWorker.made;
    expect(worker?.posted).toEqual([
      { id: 0, statement: "A.L. wrote the code.", authors: ["Ada Lovelace (A.L., AL, Lovelace A); author 1 of 1"] },
    ]);
    worker?.reply({ progress: { phase: "download", percent: 50 } });
    worker?.reply({ id: 7, result: RESULT });
    worker?.reply({ id: 0, progress: { phase: "read", done: 0, of: 1 } });
    worker?.reply({ id: 0, result: RESULT });
    await expect(pending).resolves.toEqual(RESULT);
    expect(onProgress.mock.calls).toEqual([[{ phase: "download", percent: 50 }], [{ phase: "read", done: 0, of: 1 }]]);
    // The loaded model is kept for the next statement.
    void reader.readStatement("x", ["Ada Lovelace"], vi.fn());
    expect(FakeWorker.made).toHaveLength(1);
  });

  it("rejects with the worker's error", async () => {
    const pending = reader.readStatement("x", ["Ada Lovelace"], vi.fn());
    FakeWorker.made[0]?.reply({ id: 0, error: "offline" });
    await expect(pending).rejects.toThrow("offline");
  });

  it("tells the worker to stop when aborted, before or during the reading", async () => {
    const controller = new AbortController();
    const pending = reader.readStatement("x", ["Ada Lovelace"], vi.fn(), controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.made[0]?.posted.at(-1)).toEqual({ cancel: 0 });
    await expect(reader.readStatement("x", [], vi.fn(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("starts a new worker after one fails to start", async () => {
    const pending = reader.readStatement("x", ["Ada Lovelace"], vi.fn());
    FakeWorker.made[0]?.dispatchEvent(new Event("error"));
    await expect(pending).rejects.toThrow("could not start");
    expect(FakeWorker.made[0]?.terminate).toHaveBeenCalled();
    void reader.readStatement("x", ["Ada Lovelace"], vi.fn());
    expect(FakeWorker.made).toHaveLength(2);
  });
});
