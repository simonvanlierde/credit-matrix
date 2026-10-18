"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";

/**
 * Plain SVG and HTML charts for the census page. One series each, in the ink
 * accent, so no categorical palette is needed: the markup styles are small
 * multiples on one scale rather than four colors on one plot. Every value a
 * tooltip shows is also in a table or printed beside its mark.
 */

export interface Point {
  x: number;
  y: number;
}

/** The rendered width of an element, so SVG text stays at its real size on a phone. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** Tick values from 0 to at least `max`, on a step of 1, 2 or 5 times a power of ten. */
function ticks(max: number, count: number): number[] {
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * power >= raw) ?? 10) * power;
  const out: number[] = [];
  for (let v = 0; v < max + step / 2; v += step) out.push(Number(v.toPrecision(6)));
  return out;
}

export function LineChart({
  points,
  yMax,
  formatY,
  label,
  description,
  partialAfter = Number.POSITIVE_INFINITY,
  height = 220,
  compact = false,
}: {
  points: Point[];
  yMax: number;
  formatY: (y: number) => string;
  /** Names the chart for screen readers; the table beside it carries the values. */
  label: string;
  /** One sentence on the trend, read after the name. */
  description: string;
  /** Points past this x are still being counted: drawn dashed and lighter, and never the labelled end. */
  partialAfter?: number;
  height?: number;
  compact?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const descriptionId = useId();
  const yTicks = ticks(yMax, compact ? 2 : 4);
  const top = yTicks.at(-1) ?? yMax;
  const pad = { top: 12, right: compact ? 12 : 48, bottom: 22, left: compact ? 34 : 42 };
  const first = points[0]?.x ?? 0;
  const last = points.at(-1)?.x ?? 1;
  const plotW = Math.max(width - pad.left - pad.right, 1);
  const plotH = height - pad.top - pad.bottom;
  const sx = (x: number) => pad.left + ((x - first) / Math.max(last - first, 1)) * plotW;
  const sy = (y: number) => pad.top + plotH - (y / top) * plotH;
  const path = (ps: Point[]) =>
    ps.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join("");
  const settled = points.filter((p) => p.x <= partialAfter);
  const end = settled.at(-1);
  const line = path(settled);
  // The dashed stretch starts at the last settled point, so the two lines join.
  const partial = path([...(end ? [end] : []), ...points.filter((p) => p.x > partialAfter)]);
  const area = end ? `${line}L${sx(end.x)},${sy(0)}L${sx(first)},${sy(0)}Z` : "";
  const xStep = compact || width < 480 ? 5 : 2;
  const hovered = active === null ? undefined : points[active];

  const onPointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = first + ((event.clientX - box.left - pad.left) / plotW) * (last - first);
    const nearest = points.reduce(
      (best, p, i) => (Math.abs(p.x - x) < Math.abs((points[best]?.x ?? 0) - x) ? i : best),
      0,
    );
    setActive(nearest);
  };

  return (
    <div ref={ref} className="relative" style={{ height }}>
      <p id={descriptionId} className="sr-only">
        {description}
      </p>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          aria-describedby={descriptionId}
          className="block touch-pan-y overflow-visible"
          onPointerMove={onPointer}
          onPointerLeave={() => setActive(null)}
        >
          {yTicks.map((v) => (
            <g key={v}>
              <line
                x1={pad.left}
                x2={pad.left + plotW}
                y1={sy(v)}
                y2={sy(v)}
                className="stroke-outline-variant [.dark_&]:stroke-outline"
                strokeWidth={1}
              />
              <text
                x={pad.left - 6}
                y={sy(v)}
                dy="0.32em"
                textAnchor="end"
                className="fill-on-surface-variant text-[11px] tabular-nums"
              >
                {formatY(v)}
              </text>
            </g>
          ))}
          {points
            .filter((p) => p.x % xStep === 0)
            .map((p) => (
              <text
                key={p.x}
                x={sx(p.x)}
                y={height - 6}
                textAnchor="middle"
                className="fill-on-surface-variant text-[11px] tabular-nums"
              >
                {p.x}
              </text>
            ))}
          <path d={area} className="fill-primary" fillOpacity={0.1} />
          <path
            d={line}
            fill="none"
            className="stroke-primary"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {partial.includes("L") && (
            <path
              d={partial}
              fill="none"
              className="stroke-primary"
              strokeOpacity={0.55}
              strokeWidth={2}
              strokeDasharray="4 4"
              strokeLinejoin="round"
            />
          )}
          {hovered && (
            <line
              x1={sx(hovered.x)}
              x2={sx(hovered.x)}
              y1={pad.top}
              y2={pad.top + plotH}
              className="stroke-on-surface-variant"
              strokeWidth={1}
            />
          )}
          {(hovered ?? end) && (
            <circle
              cx={sx((hovered ?? end)?.x ?? 0)}
              cy={sy((hovered ?? end)?.y ?? 0)}
              r={4}
              className="fill-primary stroke-surface-bright"
              strokeWidth={2}
            />
          )}
          {!compact && end && !hovered && (
            // Above and left of the point: the dashed partial stretch runs off to its right.
            <text
              x={sx(end.x) - 6}
              y={sy(end.y) - 10}
              textAnchor="end"
              className="fill-on-surface text-xs font-semibold"
            >
              {formatY(end.y)}
            </text>
          )}
        </svg>
      )}
      {hovered && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 rounded-md border border-outline-variant bg-surface-bright px-2 py-1 text-xs shadow-sm"
          style={{
            left: Math.min(sx(hovered.x) + 8, width - 96),
          }}
        >
          <span className="font-semibold text-on-surface tabular-nums">{formatY(hovered.y)}</span>{" "}
          <span className="text-on-surface-variant">{hovered.x}</span>
        </div>
      )}
    </div>
  );
}

export interface Bar {
  key: string;
  label: ReactNode;
  share: number;
  detail: string;
}

/** Horizontal bars, longest first, each with its value printed at the tip. */
export function BarList({ bars, formatShare }: { bars: Bar[]; formatShare: (share: number) => string }) {
  return (
    <ul className="divide-y divide-outline-variant/60">
      {bars.map((bar) => (
        <li
          key={bar.key}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 py-1.5 sm:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]"
        >
          <span className="text-sm text-on-surface">{bar.label}</span>
          <span className="col-span-2 row-start-2 flex h-2.5 items-center sm:col-span-1 sm:row-start-auto">
            {bar.share > 0 && (
              <span
                className="h-full rounded-r-[4px] bg-primary"
                style={{ width: `${Math.max(bar.share * 100, 0.5)}%` }}
              />
            )}
          </span>
          <span className="whitespace-nowrap text-right text-sm tabular-nums sm:min-w-36">
            <span className="font-semibold text-on-surface">
              {/* Whole percents would print 0% or 100% for shares that are neither. */}
              {bar.share > 0 && bar.share < 0.01
                ? `<${formatShare(0.01)}`
                : bar.share < 1 && bar.share > 0.99
                  ? `>${formatShare(0.99)}`
                  : formatShare(bar.share)}
            </span>{" "}
            <span className="text-xs text-on-surface-variant">{bar.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A table hidden behind a summary, the chart's text twin. */
export function TableToggle({
  summary,
  label,
  columns,
  rows,
}: {
  summary: string;
  /** Names the table region after its chart. */
  label: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-primary hover:underline">{summary}</summary>
      <section
        className="mt-2 overflow-x-auto rounded-md border border-outline-variant"
        // biome-ignore lint/a11y/noNoninteractiveTabindex: on a narrow screen the table scrolls sideways and holds nothing focusable, so it needs a tab stop (axe scrollable-region-focusable).
        tabIndex={0}
        aria-label={label}
      >
        <table className="w-full text-left tabular-nums">
          <thead className="sticky top-0 bg-surface-container-low text-xs text-on-surface-variant">
            <tr>
              {columns.map((c, i) => (
                <th key={c} scope="col" className={`px-3 py-1.5 font-semibold ${i ? "text-right" : ""}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/60">
            {rows.map((row) => (
              <tr key={String(row[0])}>
                {row.map((cell, i) =>
                  i ? (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed column order
                    <td key={i} className="px-3 py-1 text-right">
                      {cell}
                    </td>
                  ) : (
                    <th key="head" scope="row" className="px-3 py-1 font-normal">
                      {cell}
                    </th>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </details>
  );
}
