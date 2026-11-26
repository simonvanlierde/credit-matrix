import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cast } from "@/core/__tests__/cast";
import { authorText, chunks, combine, decode, initials, statementRoom } from "./statement-reader";

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

describe("chunks", () => {
  // As census/tests/test_onepass.py, with the same token ids.
  const [CLS, SEP, M] = [1, 2, 99];
  const ids = { cls: CLS, sep: SEP, marker: M };
  const fill = (n: number, id: number) => Array<number>(n).fill(id);

  it("marks each author before the statement in one chunk", () => {
    const [chunk, ...rest] = chunks([[5, 6], [7]], [8, 8, 8], ids, 40);
    expect(rest).toEqual([]);
    expect(chunk).toEqual({ authors: [0, 1], ids: [CLS, M, 5, 6, M, 7, SEP, 8, 8, 8, SEP], markers: [1, 4] });
    expect(chunks([], [8], ids, 40)).toEqual([]);
  });

  it("splits a long byline into chunks that each repeat the statement", () => {
    const authors = [0, 1, 2, 3, 4].map((i) => fill(3, 10 + i)); // 4 tokens each with its marker
    const statement = fill(9, 8);
    const made = chunks(authors, statement, ids, 20); // room for 8 author tokens: 2 authors per chunk
    expect(made.map((c) => c.authors)).toEqual([[0, 1], [2, 3], [4]]);
    for (const c of made) {
      expect(c.ids.length).toBeLessThanOrEqual(20);
      expect(c.ids.slice(-statement.length - 2)).toEqual([SEP, ...statement, SEP]);
      expect(c.markers.map((p) => c.ids[p + 1])).toEqual(c.authors.map((i) => 10 + i));
    }
  });

  it("cuts a long statement to leave room for its authors", () => {
    const [made, ...rest] = chunks([fill(4, 5), [6]], fill(100, 8), ids, 32); // the whole byline fits in 7
    expect(rest).toEqual([]);
    expect(made?.ids).toHaveLength(32);
    expect(made?.ids.filter((id) => id === 8)).toHaveLength(32 - 3 - 7);
    const [runaway] = chunks([fill(50, 5)], fill(100, 8), ids, 32); // an author cut at a quarter
    expect(runaway?.ids.slice(0, 10)).toEqual([CLS, M, ...fill(8, 5)]);
    expect(runaway?.ids).toHaveLength(32);
    // Near max_length, a quarter goes to authors: 5 per chunk here, not 1.
    const many = chunks(
      fill(10, 0).map(() => [5]),
      fill(100, 8),
      ids,
      40,
    );
    expect(many.map((c) => [c.authors.length, c.ids.length])).toEqual([
      [5, 40],
      [5, 40],
    ]);
    expect(
      statementRoom(
        fill(10, 0).map(() => [5]),
        40,
      ),
    ).toBe(27);
  });

  it("cuts at the model's 1,024 tokens by default, an author at 256", () => {
    expect(statementRoom([fill(300, 5)])).toBe(1024 - 3 - 257);
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
      roles: [{ role: "Conceptualization" }, { role: "Software", note: "check" }],
      maybe: ["Validation"],
    });
    expect(alan).toEqual({ roles: [{ role: "Conceptualization" }], maybe: ["Software"] });
  });
});

describe("combine", () => {
  // Ada: conceptualization (sure), software (close call). Alan: validation only.
  const result = {
    labels: ["conceptualization", "software", "validation"],
    threshold: 0.4,
    probabilities: [
      [0.9, 0.5, 0.3],
      [0.1, 0.1, 0.9],
    ],
  };

  it("keeps the rules' roles as they are without the model", () => {
    expect(combine([["Software"], []])).toEqual([
      { roles: [{ role: "Software" }], suggested: [], maybe: [] },
      { roles: [], suggested: [], maybe: [] },
    ]);
  });

  it("questions the rules' roles the model did not find, and offers the ones only it found", () => {
    expect(combine([["Conceptualization"], ["Software"]], result)).toEqual([
      { roles: [{ role: "Conceptualization" }], suggested: ["Software"], maybe: [] },
      { roles: [{ role: "Software", note: "doubt" }], suggested: ["Validation"], maybe: [] },
    ]);
  });

  it("lets the model's reading stand when the rules found nothing", () => {
    expect(combine([[], []], result)).toEqual([
      {
        roles: [{ role: "Conceptualization" }, { role: "Software", note: "check" }],
        suggested: [],
        maybe: ["Validation"],
      },
      { roles: [{ role: "Validation" }], suggested: [], maybe: [] },
    ]);
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

const RESULT = { probabilities: [[0.9]], labels: ["software"], threshold: 0.4 };

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
