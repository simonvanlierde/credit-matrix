import { type RefObject, useLayoutEffect, useState } from "react";

/** Width of the key when it stands beside the grid, and its gap from the last column (px). */
export const SIDE_KEY_W = 128;
export const SIDE_KEY_GAP = 24;

export interface GridBox {
  /** The grid's cells alone, without row labels or the header. */
  cellsW: number;
  cellsH: number;
  tableW: number;
  headH: number;
  /** The middle column the grid sits in, and the block the grid and toolbar form. */
  paneLeft: number;
  paneW: number;
  blockW: number;
  viewportW: number;
}

export interface GridPlacement {
  /** The key stands beside the grid, top-aligned with its first row. */
  side: boolean;
  keyTop: number;
  keyLeft: number;
  /** Horizontal shift of the block toward the window's centre. */
  shift: number;
}

/**
 * Where the grid's key goes and how far the grid moves toward the window's centre.
 * The key follows the figure export's rule (heatmap-svg.ts): beside a matrix at least
 * 1.5 times as tall as it is wide, if the column has room, else below. The side panels
 * differ in width, so a block centred in its column sits off the window's centre; it
 * moves toward it only as far as the column's spare width allows.
 */
export function placeGrid(box: GridBox): GridPlacement {
  const side = box.cellsW > 0 && box.cellsH >= box.cellsW * 1.5 && box.tableW + SIDE_KEY_GAP + SIDE_KEY_W <= box.paneW;
  const spare = Math.max(0, (box.paneW - box.blockW) / 2);
  const offCentre = box.viewportW / 2 - (box.paneLeft + box.paneW / 2);
  return {
    side,
    keyTop: box.headH,
    keyLeft: box.tableW + SIDE_KEY_GAP,
    shift: Math.round(Math.max(-spare, Math.min(spare, offCentre))),
  };
}

const NONE: GridPlacement = { side: false, keyTop: 0, keyLeft: 0, shift: 0 };

/**
 * Measures the grid live (rail collapse, window resize, new columns) and places it. `columns`
 * re-attaches the measuring when the table mounts or its shape changes.
 */
export function useGridPlacement(
  blockRef: RefObject<HTMLElement | null>,
  tableRef: RefObject<HTMLTableElement | null>,
  columns: number,
): GridPlacement {
  const [placement, setPlacement] = useState(NONE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: columns only re-runs the effect.
  useLayoutEffect(() => {
    const block = blockRef.current;
    const table = tableRef.current;
    const pane = block?.parentElement;
    if (!(block && table && pane)) return;
    const measure = () => {
      const tableRect = table.getBoundingClientRect();
      const headH = table.tHead?.getBoundingClientRect().height ?? 0;
      const rowLabelW = table.tBodies[0]?.rows[0]?.cells[0]?.getBoundingClientRect().width ?? 0;
      const paneRect = pane.getBoundingClientRect();
      const next = placeGrid({
        cellsW: tableRect.width - rowLabelW,
        cellsH: tableRect.height - headH,
        tableW: tableRect.width,
        headH,
        paneLeft: paneRect.left,
        paneW: paneRect.width,
        blockW: block.offsetWidth,
        viewportW: document.documentElement.clientWidth,
      });
      setPlacement((current) =>
        current.side === next.side &&
        current.keyTop === next.keyTop &&
        current.keyLeft === next.keyLeft &&
        current.shift === next.shift
          ? current
          : next,
      );
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    for (const element of [block, table, pane]) observer.observe(element);
    return () => observer.disconnect();
  }, [blockRef, tableRef, columns]);
  return placement;
}
