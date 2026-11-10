// biome-ignore lint/correctness/noNodejsModules: retain measured figures as Playwright artifacts.
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import type { FigureRenderer } from "credit-matrix/figures";
import { contrastRatio } from "../src/core/contributor-color";
import { AVAILABLE_LOCALES, loadRoleCatalog, makeRoleTranslator } from "../src/core/credit-i18n";
import { loadUiCatalog, makeUiTranslator } from "../src/core/credit-i18n/ui-strings";
import { CREDIT_ROLES } from "../src/core/credit-roles";

let figures: FigureRenderer;
test.beforeAll(async () => {
  const { createFigureRenderer } = await import("credit-matrix/figures");
  figures = await createFigureRenderer();
});

import { createAuthor } from "../src/core/parse-authors";
import { heatmapPrintSize } from "../src/lib/heatmap-print";

const scenarios = [
  { name: "single-column", widthMm: 89, count: 3, horizontal: false, marks: false },
  { name: "double-column-long-names", widthMm: 183, count: 12, horizontal: true, marks: true },
];

for (const { code } of AVAILABLE_LOCALES) {
  for (const font of ["sans", "serif"] as const) {
    for (const scenario of scenarios) {
      // biome-ignore lint/suspicious/noLoopFunc: beforeAll initializes the shared renderer once per worker.
      test(`${code} ${font} ${scenario.name}: readable text and unclipped layout at print size`, async ({
        page,
      }, info) => {
        const authors = Array.from({ length: scenario.count }, (_, i) =>
          createAuthor(scenario.count > 3 ? `Alexandra Montgomery Rivera ${i + 1}` : `Researcher ${i + 1}`, {
            contributions: CREDIT_ROLES.map((role, r) => ({ role: role.name, score: ((i + r) % 4) * 33 })),
          }),
        );
        const svg = figures.svg(authors, {
          font,
          acronyms: false,
          horizontal: scenario.horizontal,
          marks: scenario.marks,
          locale: code,
          translateRole: makeRoleTranslator(await loadRoleCatalog(code)),
          translateUi: makeUiTranslator(await loadUiCatalog(code)),
        });
        expect(svg).toContain(`>${authors[0]?.name}</tspan>`);
        const requested = heatmapPrintSize(svg, scenario.widthMm);
        // Fit within the reference column and 170 mm height while retaining at least 5 pt text.
        // https://research-figure-guide.nature.com/figures/building-and-exporting-figure-panels/
        const widthMm = Math.min(scenario.widthMm, (scenario.widthMm * 170) / requested.heightMm);
        const metrics = heatmapPrintSize(svg, widthMm);
        expect(metrics.minFontPt).toBeGreaterThanOrEqual(5);
        expect(metrics.heightMm).toBeLessThanOrEqual(170 + 1e-6);
        await page.emulateMedia({ media: "print" });
        await page.setContent(svg);
        const measured = await page.evaluate(async (physicalWidthMm) => {
          await document.fonts.ready;
          const root = document.querySelector("svg");
          if (!root) throw new Error("Missing SVG");
          root.style.width = `${physicalWidthMm}mm`;
          root.style.height = "auto";
          const labels = [...root.querySelectorAll("text")];
          const view = root.viewBox.baseVal;
          const inkContext = document.createElement("canvas").getContext("2d");
          if (!inkContext) throw new Error("Missing text measurement context");
          inkContext.textAlign = "left";
          const bounds = labels.map((label) => {
            const matrix = label.transform.baseVal.consolidate()?.matrix ?? new DOMMatrix();
            const polygon = (box: { x: number; y: number; width: number; height: number }) =>
              [
                [box.x, box.y],
                [box.x + box.width, box.y],
                [box.x + box.width, box.y + box.height],
                [box.x, box.y + box.height],
              ].map(([x, y]) => {
                const p = new DOMPoint(x, y).matrixTransform(matrix);
                return { x: p.x, y: p.y };
              });
            const style = getComputedStyle(label);
            inkContext.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const ink = inkContext.measureText(label.textContent ?? "");
            const advance = label.getComputedTextLength();
            const anchorX =
              (label.x.baseVal.numberOfItems ? label.x.baseVal.getItem(0).value : 0) -
              (style.textAnchor === "end" ? advance : style.textAnchor === "middle" ? advance / 2 : 0);
            const baselineY = label.y.baseVal.numberOfItems ? label.y.baseVal.getItem(0).value : 0;
            // Firefox's CJK font box includes scale-dependent padding; glyph bounds avoid false collisions.
            return {
              frame: polygon(label.getBBox()),
              glyph: polygon({
                x: anchorX - ink.actualBoundingBoxLeft,
                y: baselineY - ink.actualBoundingBoxAscent,
                width: ink.actualBoundingBoxLeft + ink.actualBoundingBoxRight,
                height: ink.actualBoundingBoxAscent + ink.actualBoundingBoxDescent,
              }),
            };
          });
          const polygons = bounds.map((bound) => bound.glyph);
          // Rotated labels need polygon separation; axis-aligned boxes overstate their overlap.
          const overlap = (a: (typeof polygons)[number], b: (typeof polygons)[number]) =>
            [a, b].every((polygon) =>
              polygon.every((point, i) => {
                const next = polygon[(i + 1) % polygon.length];
                if (!next) throw new Error("Missing polygon edge");
                const axis = { x: next.y - point.y, y: point.x - next.x };
                const projection = (shape: typeof a) => shape.map((p) => p.x * axis.x + p.y * axis.y);
                const pa = projection(a);
                const pb = projection(b);
                return Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)) > 0.01;
              }),
            );
          const clipped = bounds.flatMap((bound, i) =>
            bound.frame.some((p) => p.x < -0.01 || p.y < -0.01 || p.x > view.width + 0.01 || p.y > view.height + 0.01)
              ? [labels[i]?.textContent]
              : [],
          );
          const collisions: string[] = [];
          polygons.forEach((a, i) => {
            polygons.slice(i + 1).forEach((b, j) => {
              if (overlap(a, b)) collisions.push(`${labels[i]?.textContent} / ${labels[i + j + 1]?.textContent}`);
            });
          });
          const marks = [...root.querySelectorAll('g[aria-hidden="true"], path[aria-hidden="true"]')].map((mark) => ({
            ink: mark.getAttribute("stroke") ?? mark.getAttribute("fill") ?? "",
            fill: mark.previousElementSibling?.getAttribute("fill") ?? "",
          }));
          const first = polygons[0];
          if (!first) throw new Error("Missing label geometry");
          return {
            overlapControl: overlap(first, first),
            separationControl: overlap(
              first,
              first.map((point) => ({ x: point.x + view.width + 1000, y: point.y })),
            ),
            clipped,
            collisions,
            marks,
            textColors: labels.map((label) => label.getAttribute("fill") ?? ""),
            renderedWidthPx: root.getBoundingClientRect().width,
            minRenderedFontPt:
              (((Math.min(...labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize))) *
                root.getBoundingClientRect().width) /
                view.width) *
                72) /
              96,
          };
        }, widthMm);
        await writeFile(info.outputPath("figure.svg"), svg);
        await writeFile(
          info.outputPath("print-metrics.json"),
          JSON.stringify(
            {
              locale: code,
              font,
              scenario: scenario.name,
              browser: info.project.name,
              columnWidthMm: scenario.widthMm,
              ...metrics,
              ...measured,
            },
            null,
            2,
          ),
        );
        await page.locator("svg").screenshot({ path: info.outputPath("figure.png") });
        expect(measured.overlapControl).toBe(true);
        expect(measured.separationControl).toBe(false);
        expect(measured.clipped).toEqual([]);
        expect(measured.collisions).toEqual([]);
        expect(measured.renderedWidthPx).toBeCloseTo((widthMm / 25.4) * 96, 1);
        expect(measured.minRenderedFontPt).toBeCloseTo(metrics.minFontPt, 2);
        for (const color of measured.textColors) expect(contrastRatio(color, "#ffffff")).toBeGreaterThanOrEqual(4.5);
        if (scenario.marks) expect(measured.marks.length).toBeGreaterThan(0);
        else expect(measured.marks).toEqual([]);
        for (const mark of measured.marks) expect(contrastRatio(mark.ink, mark.fill)).toBeGreaterThanOrEqual(3);
      });
    }
  }
}

test("a dense team remains valid but cannot be called readable at single-column width", () => {
  const authors = Array.from({ length: 100 }, (_, i) =>
    createAuthor(`Researcher ${i + 1}`, {
      contributions: [{ role: "Software", score: 100 }],
    }),
  );
  expect(heatmapPrintSize(figures.svg(authors), 89).minFontPt).toBeLessThan(5);
  expect(heatmapPrintSize(figures.svg(authors, { horizontal: true }), 183).minFontPt).toBeGreaterThanOrEqual(5);
  expect(heatmapPrintSize(figures.svg(authors, { horizontal: true }), 183).heightMm).toBeGreaterThan(170);
});
