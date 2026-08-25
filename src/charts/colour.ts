/**
 * Colour ramps, semantic roles, and binning. Pure functions of numbers to CSS
 * colour strings.
 *
 * Every colour here is a `var(--chart-*)` reference whose two theme values live
 * in src/index.css. SVG `fill`/`stroke` and React `style` all accept `var()`, so
 * the whole chart layer re-themes with no React plumbing and no re-render --
 * including the tooltip, which portals outside the app tree.
 *
 * This still honours the original constraint of staying testable in Node: the
 * functions EMIT variable references, they never READ them. `getComputedStyle`
 * is never called, and every function remains a pure string mapping.
 */

import { binIndex, quantileThresholds } from '../derive/stats';

/**
 * Sequential ramp, ordered least-intense to most-intense.
 *
 * That direction is a contract, not a convention: `quantileBinner` below skips
 * the weakest step assuming index 0 is it. The light theme runs pale to deep;
 * the dark theme runs near-black to bright lime. Reusing one theme's hexes for
 * the other would make every heatmap unreadable.
 */
export const SEQUENTIAL = [
  'var(--chart-seq-0)',
  'var(--chart-seq-1)',
  'var(--chart-seq-2)',
  'var(--chart-seq-3)',
  'var(--chart-seq-4)',
  'var(--chart-seq-5)',
  'var(--chart-seq-6)',
  'var(--chart-seq-7)',
  'var(--chart-seq-8)',
] as const;

/**
 * Diverging, with a neutral midpoint at index 4.
 *
 * Cyan <-> amber rather than anything involving red: red is already spoken for
 * by the error and warning surfaces, and a "high volume" cell must not read as
 * an alert.
 */
export const DIVERGING = [
  'var(--chart-div-0)',
  'var(--chart-div-1)',
  'var(--chart-div-2)',
  'var(--chart-div-3)',
  'var(--chart-div-4)',
  'var(--chart-div-5)',
  'var(--chart-div-6)',
  'var(--chart-div-7)',
  'var(--chart-div-8)',
] as const;

/** Categorical slots, in fixed order. Never cycle past the end. */
export const CATEGORICAL = [
  'var(--chart-cat-0)',
  'var(--chart-cat-1)',
  'var(--chart-cat-2)',
  'var(--chart-cat-3)',
  'var(--chart-cat-4)',
  'var(--chart-cat-5)',
  'var(--chart-cat-6)',
  'var(--chart-cat-7)',
] as const;

/**
 * Semantic roles.
 *
 * These reclaim the colours that used to sit as loose hex literals across the
 * five viz files. Naming them by ROLE rather than by hue is what lets the two
 * themes disagree about the actual colour: `PRIMARY` is deep olive on white and
 * bright lime on near-black.
 */
export const INK = 'var(--chart-ink)';
export const INK_DIM = 'var(--chart-ink-dim)';
export const AXIS = 'var(--chart-axis)';
export const AXIS_TEXT = 'var(--chart-axis-text)';

/** The main measured series. */
export const PRIMARY = 'var(--chart-primary)';
/** Area fills and secondary marks belonging to the main series. */
export const PRIMARY_SOFT = 'var(--chart-primary-soft)';
/** The opposing series in any two-way comparison. */
export const CONTRAST = 'var(--chart-contrast)';
export const CONTRAST_SOFT = 'var(--chart-contrast-soft)';
/** Personal bests and other "achievement" marks. */
export const GOOD = 'var(--chart-good)';
/** De-emphasised marks: diagonals, reference lines, secondary loads. */
export const MUTED = 'var(--chart-muted)';
/** Background band behind a chart region, e.g. the "balanced" zone. */
export const BAND = 'var(--chart-band)';
/** Ring drawn on cells whose grouping rests on unconfirmed tags. */
export const FLAG = 'var(--chart-flag)';

export const NEUTRAL_INK = AXIS;
export const EMPTY_FILL = 'var(--chart-empty)';
export const EMPTY_STROKE = 'var(--chart-empty-stroke)';

function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

function ramp(colors: readonly string[], t: number): string {
  const i = Math.round(clamp01(t) * (colors.length - 1));
  return colors[i] ?? (colors[0] as string);
}

export function sequential(t: number): string {
  return ramp(SEQUENTIAL, t);
}

/** `t` in -1..1, where 0 is the neutral midpoint. */
export function diverging(t: number): string {
  return ramp(DIVERGING, clamp01((t + 1) / 2));
}

export function categorical(slot: number): string {
  // Clamp rather than wrap: a repeated colour is worse than a grey one.
  const i = Math.max(0, Math.min(CATEGORICAL.length - 1, slot));
  return CATEGORICAL[i] ?? NEUTRAL_INK;
}

export type QuantileBinner = {
  (value: number): string;
  thresholds: number[];
  binCount: number;
  /** Inclusive display range of each bin, for the legend. */
  ranges: Array<[number, number]>;
};

/**
 * Quantile-binned sequential colour.
 *
 * Training volume is heavily right-skewed -- in the reference corpus the median
 * session is ~4.5k kg but the top is ~25k. A linear ramp leaves almost every
 * cell in the palest step, so bins are cut at quantiles of the user's OWN
 * history. The legend must therefore print the real values: a shade means
 * "busy for you", never an absolute quantity.
 */
export function quantileBinner(values: number[], binCount = 5): QuantileBinner {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  const thresholds = quantileThresholds(positive, binCount);
  const actualBins = thresholds.length + 1;

  const lo = positive.length ? Math.min(...positive) : 0;
  const hi = positive.length ? Math.max(...positive) : 0;
  const edges = [lo, ...thresholds, hi];
  const ranges: Array<[number, number]> = [];
  for (let i = 0; i < actualBins; i++) {
    ranges.push([edges[i] ?? 0, edges[i + 1] ?? hi]);
  }

  const fn = ((value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return EMPTY_FILL;
    const idx = binIndex(value, thresholds);
    // Skip the weakest ramp step so the lowest bin still reads as "trained".
    const t = actualBins <= 1 ? 0.6 : 0.25 + (idx / (actualBins - 1)) * 0.75;
    return sequential(t);
  }) as QuantileBinner;

  fn.thresholds = thresholds;
  fn.binCount = actualBins;
  fn.ranges = ranges;
  return fn;
}
