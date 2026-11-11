import {
  contrastRatio,
  contributorHues,
  HEX_COLOR,
  heatCellColor,
  mixHex,
  pageMarkColor,
} from "../core/contributor-color";

/** The page and card grounds per theme (globals.css): the page is paper tinted with the hue. */
const GROUND = {
  light: { paper: "#fbf8f1", tint: 0.03, bright: "#fffdf8" },
  dark: { paper: "#161513", tint: 0.04, bright: "#24221f" },
};

/**
 * The accent for a heatmap hue: the hue as the mark draws it, deepened toward the
 * theme's ink (black in light mode, white in dark) only as far as it takes to reach
 * 4.5:1 for text on every ground it sits on: bright paper (and bright paper text on
 * it), the hue-tinted page, and the initials chip's own 10% accent wash over the page.
 * Null for a value that is not a hex colour.
 */
export function accentFor(hue: string, dark: boolean): string | null {
  if (!HEX_COLOR.test(hue)) return null;
  const base = pageMarkColor(hue, dark);
  const ground = dark ? GROUND.dark : GROUND.light;
  const page = mixHex(ground.paper, hue, ground.tint);
  for (let t = 0; t <= 1; t += 0.05) {
    const accent = mixHex(base, dark ? "#ffffff" : "#000000", t);
    const grounds = [ground.bright, page, mixHex(page, accent, 0.1)];
    if (grounds.every((g) => contrastRatio(accent, g) >= 4.5)) return accent;
  }
  return null;
}

/** Apply the same colours before first paint and after draft or theme changes. */
export function applyThemeColors(root: CSSStyleDeclaration, hue: string, dark: boolean, people: number | null) {
  const hues = people === null ? null : contributorHues(people);
  root.setProperty("--color-theme", hues ? "var(--color-paper)" : hue);
  const accent = hues ? null : accentFor(hue, dark);
  for (const property of ["--color-accent", "--color-primary", "--color-primary-hover"]) {
    if (accent)
      root.setProperty(
        property,
        property.endsWith("-hover") ? mixHex(accent, dark ? "#ffffff" : "#000000", 0.12) : accent,
      );
    else root.removeProperty(property);
  }
  for (let column = 0; column < 3; column++) {
    for (const score of [33, 66, 100]) {
      root.setProperty(`--color-mark-${column}-${score}`, heatCellColor(hues?.[column] ?? hue, score, dark));
    }
  }
}
