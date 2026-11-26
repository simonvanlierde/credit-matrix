import { describe, expect, it } from "vitest";
import { tokenizer } from "./tokenizer";

// reader-parity.test.ts checks the real vocabulary against Python; these pin the rules on a toy one.
const toy = tokenizer({
  model: {
    vocab: { a: 1, b: 2, ab: 3, abb: 4, Ġ: 5, Ġa: 6, Ã: 8, "©": 9 },
    // The older tokenizer.json form, one string per merge, as well as pairs.
    merges: ["a b", ["ab", "b"], ["Ġ", "a"], ["Ã", "©"]],
  },
  added_tokens: [
    { id: 20, content: "[m]" },
    { id: 21, content: "  " },
  ],
});

describe("the BPE tokenizer", () => {
  it("merges the lowest-ranked pair first", () => {
    expect(toy.encode("abb")).toEqual([4]);
    expect(toy.encode("bab")).toEqual([2, 3]);
  });

  it("splits added tokens out first, the longest at each place", () => {
    expect(toy.encode("a[m]b")).toEqual([1, 20, 2]);
    expect(toy.encode("a   a")).toEqual([1, 21, 6]);
    expect(toy.id("[m]")).toBe(20);
    expect(toy.id("ab")).toBe(3);
  });

  it("reads NFC bytes in GPT-2's alphabet, and a piece missing from the vocabulary as 0", () => {
    // é (U+00E9) is the bytes C3 A9, spelled "Ã©"; e + U+0301 composes to it first.
    expect(toy.encode("e\u0301")).toEqual(toy.encode("é"));
    expect(toy.encode("é")).toEqual([0]);
    expect(toy.encode("c")).toEqual([0]);
  });

  it("cuts a word longer than the longest token before merging, so a pasted run of letters reads at once", () => {
    // Uncut, 100,000 x's cost 50,000 scans of the whole word for the first merge alone.
    const runs = tokenizer({
      model: {
        vocab: { x: 1, xx: 2, xxxx: 3 },
        merges: [
          ["x", "x"],
          ["xx", "xx"],
        ],
      },
      added_tokens: [{ id: 9, content: "[m]" }],
    });
    expect(runs.encode("x".repeat(7))).toEqual([3, 2, 1]);
    const started = performance.now();
    expect(runs.encode("x".repeat(100_000))).toEqual(Array(25_000).fill(3));
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
