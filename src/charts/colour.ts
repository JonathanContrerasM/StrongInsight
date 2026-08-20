/**
 * Colour ramps and binning. Pure functions of numbers to hex strings.
 *
 * Kept free of CSS-variable reads so it stays testable in Node.
 */

import { binIndex, quantileThresholds } from '../derive/stats';

/** Sequential blue: light to dark, single hue. */
export const SEQUENTIAL = [
  '#eff6ff',
  '#dbeafe',
  '#bfdbfe',
  '#93c5fd',
  '#60a5fa',
  '#3b82f6',
  '#2563eb',
  '#1d4ed8',
  '#1e40af',
] as const;

/**
 * Diverging blue <-> orange with a neutral grey midpoint.
 *
 * Orange rather than red deliberately: red is already spoken for by the app's
 * error and warning surfaces, and a "high volume" cell must not read as an alert.
 */
export const DIVERGING = [
  '#1e40af',
  '#2563eb',
  '#60a5fa',
  '#bfdbfe',
  '#f1f0ee',
  '#fed7aa',
  '#fb923c',
  '#ea580c',
  '#9a3412',
] as const;

/** Categorical slots, in fixed order. Never cycle past the end. */
export const CATEGORICAL = [
  '#2563eb',
  '#ea580c',
  '#16a34a',
  '#9333ea',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#4b5563',
] as const;

export const NEUTRAL_INK = '#94a3b8';
export const EMPTY_FILL = '#f8fafc';
export const EMPTY_STROKE = '#e2e8f0';

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
  return ramp(DIVERGING, (clamp01((t + 1) / 2)));
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
    // Skip the palest ramp step so the lowest bin still reads as "trained".
    const t = actualBins <= 1 ? 0.6 : 0.25 + (idx / (actualBins - 1)) * 0.75;
    return sequential(t);
  }) as QuantileBinner;

  fn.thresholds = thresholds;
  fn.binCount = actualBins;
  fn.ranges = ranges;
  return fn;
}
