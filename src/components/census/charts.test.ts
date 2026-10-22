import { describe, expect, it } from "vitest";
import { ticks } from "./charts";

describe("ticks", () => {
  it("reaches at least the largest value", () => {
    // The contribution-statement share, which drew above its plot when the top tick rounded down.
    expect(ticks(0.2857, 2)).toEqual([0, 0.2, 0.4]);
    expect(ticks(0.2362, 2).at(-1)).toBeGreaterThanOrEqual(0.2362);
  });

  it("stops at a value that falls on a tick", () => {
    expect(ticks(0.2, 2)).toEqual([0, 0.1, 0.2]);
    expect(ticks(0.6, 4)).toEqual([0, 0.2, 0.4, 0.6]);
  });
});
