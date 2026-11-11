import { describe, expect, it } from "vitest";
import { type GridBox, placeGrid, SIDE_KEY_GAP, SIDE_KEY_W } from "./grid-placement";

const box = (over: Partial<GridBox> = {}): GridBox => ({
  cellsW: 132,
  cellsH: 392,
  tableW: 340,
  headH: 120,
  paneLeft: 288,
  paneW: 800,
  blockW: 500,
  viewportW: 1440,
  ...over,
});

describe("placeGrid", () => {
  it("puts the key beside a grid at least 1.5 times as tall as wide, at its first row", () => {
    expect(placeGrid(box())).toMatchObject({ side: true, keyTop: 120, keyLeft: 340 + SIDE_KEY_GAP });
  });

  it("puts the key below a wide grid", () => {
    expect(placeGrid(box({ cellsW: 352 })).side).toBe(false);
  });

  it("keeps the key below when the column has no room beside the grid", () => {
    expect(placeGrid(box({ paneW: 340 + SIDE_KEY_GAP + SIDE_KEY_W - 1 })).side).toBe(false);
  });

  it("moves the block toward the window's centre, up to the column's spare width", () => {
    // Pane centre 688, window centre 720: 32 px right, within (800 - 500) / 2 spare.
    expect(placeGrid(box()).shift).toBe(32);
    // Only 10 px spare: clamped.
    expect(placeGrid(box({ blockW: 780 })).shift).toBe(10);
    expect(placeGrid(box({ paneLeft: 400 })).shift).toBe(-80);
  });
});
