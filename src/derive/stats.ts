/**
 * Small statistical helpers. Pure, no dependencies.
 *
 * Volume in real training data is heavily right-skewed (in the reference corpus:
 * median ~4.5k, p90 ~11k, max ~25k), so linear colour scales wash out. Quantile
 * binning is the default everywhere a magnitude becomes a colour.
 */

/** Ascending copy with non-finite values removed. */
export function sortedFinite(values: number[]): number[] {
  return values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
}

/** Linear-interpolated quantile. `q` is 0..1. Returns null for empty input. */
export function quantile(sortedValues: number[], q: number): number | null {
  const n = sortedValues.length;
  if (n === 0) return null;
  if (n === 1) return sortedValues[0] ?? null;
  const pos = (n - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sortedValues[lo];
  const b = sortedValues[hi];
  if (a === undefined || b === undefined) return null;
  return lo === hi ? a : a + (b - a) * (pos - lo);
}

/**
 * Thresholds splitting `values` into `binCount` quantile bins.
 * Returns binCount-1 cut points, strictly increasing, de-duplicated.
 *
 * Degenerate data (all values equal, or fewer values than bins) yields fewer
 * thresholds rather than a run of identical ones, so callers must not assume a
 * fixed length.
 */
export function quantileThresholds(values: number[], binCount: number): number[] {
  const sorted = sortedFinite(values);
  if (sorted.length === 0 || binCount < 2) return [];
  const cuts: number[] = [];
  for (let i = 1; i < binCount; i++) {
    const q = quantile(sorted, i / binCount);
    if (q !== null) cuts.push(q);
  }
  // Strictly increasing only: identical cuts would create empty, unreachable bins.
  const max = sorted[sorted.length - 1] as number;
  const out: number[] = [];
  for (const c of cuts) {
    const last = out[out.length - 1];
    // A cut at or above the maximum makes the bin beyond it unreachable, which
    // shows up as a legend entry no data can ever land in.
    if (c >= max) continue;
    if (last === undefined || c > last) out.push(c);
  }
  return out;
}

/** Index of the bin `value` falls into, given ascending thresholds. */
export function binIndex(value: number, thresholds: number[]): number {
  let i = 0;
  while (i < thresholds.length && value > (thresholds[i] as number)) i++;
  return i;
}

export function mean(values: number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  return finite.reduce((a, b) => a + b, 0) / finite.length;
}

/**
 * Centred rolling mean over `window` points, shrinking at the edges so the
 * output is the same length as the input and never introduces leading nulls.
 */
export function rollingMean(values: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return values.slice();
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice: number[] = [];
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (v !== null && v !== undefined && Number.isFinite(v)) slice.push(v);
    }
    return mean(slice);
  });
}

export function median(values: number[]): number | null {
  const s = sortedFinite(values);
  if (s.length === 0) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}

/**
 * Centred rolling MEDIAN. This is the smoother strength progression should use.
 *
 * Deload sessions are one-sided outliers -- a light week drags a rolling *mean*
 * down precisely when the trend matters most. A median ignores them. The
 * reference corpus has several such months (squat top sets drop to 50 kg in
 * 2025-07, 2025-12 and 2026-05), so this is not a hypothetical concern.
 */
export function rollingMedian(values: Array<number | null>, window: number): Array<number | null> {
  if (window <= 1) return values.slice();
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice: number[] = [];
    for (let j = i - half; j <= i + half; j++) {
      const v = values[j];
      if (v !== null && v !== undefined && Number.isFinite(v)) slice.push(v);
    }
    return median(slice);
  });
}

/** Running maximum, ignoring nulls. This is the "personal best" line. */
export function runningMax(values: Array<number | null>): Array<number | null> {
  let best: number | null = null;
  return values.map((v) => {
    if (v !== null && Number.isFinite(v) && (best === null || v > best)) best = v;
    return best;
  });
}

export type Segment<T> = { points: T[]; gapDaysBefore: number | null };

/**
 * Split a chronological series wherever the gap exceeds `maxGapDays`.
 *
 * Drawing one continuous line across a training layoff invents data: it implies
 * a smooth progression through weeks where nothing was logged. Charts render one
 * path per segment so a break reads as a break.
 */
export function segmentByGap<T extends { date: Date }>(points: T[], maxGapDays: number): Array<Segment<T>> {
  const sorted = points.slice().sort((a, b) => a.date.getTime() - b.date.getTime());
  const out: Array<Segment<T>> = [];
  let cur: T[] = [];
  let gapBefore: number | null = null;

  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i] as T;
    const prev = sorted[i - 1];
    if (prev) {
      const gapDays = (p.date.getTime() - prev.date.getTime()) / 86400000;
      if (gapDays > maxGapDays) {
        out.push({ points: cur, gapDaysBefore: gapBefore });
        cur = [];
        gapBefore = gapDays;
      }
    }
    cur.push(p);
  }
  if (cur.length > 0) out.push({ points: cur, gapDaysBefore: gapBefore });
  return out;
}

export type TrendLine = { slope: number; intercept: number; at(x: number): number };

/**
 * Ordinary least squares over (x, y) pairs. Returns null when there is nothing
 * to fit (fewer than 2 points, or zero variance in x).
 */
export function linearTrend(points: Array<{ x: number; y: number }>): TrendLine | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 2) return null;

  let sx = 0;
  let sy = 0;
  for (const p of pts) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;

  let num = 0;
  let den = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    num += dx * (p.y - my);
    den += dx * dx;
  }
  if (den === 0) return null;

  const slope = num / den;
  const intercept = my - slope * mx;
  return { slope, intercept, at: (x: number) => slope * x + intercept };
}

/** Sample standard deviation. Null below two finite values. */
export function stdev(values: number[]): number | null {
  const v = sortedFinite(values);
  if (v.length < 2) return null;
  const m = (v.reduce((a, b) => a + b, 0)) / v.length;
  const ss = v.reduce((a, b) => a + (b - m) * (b - m), 0);
  return Math.sqrt(ss / (v.length - 1));
}

/**
 * One-proportion z: how far an observed rate sits from an expected one, in
 * standard errors.
 *
 * Returns null when the normal approximation does not hold. A handful of weeks
 * cannot support a claim about which weekday gets skipped, and a number computed
 * anyway would look exactly as authoritative as a real one.
 */
export function proportionZ(
  successes: number,
  trials: number,
  expectedRate: number,
): number | null {
  if (!Number.isFinite(successes) || !Number.isFinite(trials) || trials <= 0) return null;
  if (!(expectedRate > 0 && expectedRate < 1)) return null;
  // The usual rule of thumb: both expected successes and failures need to be
  // large enough for the normal curve to stand in for the binomial.
  if (trials * expectedRate < 5 || trials * (1 - expectedRate) < 5) return null;
  const se = Math.sqrt((expectedRate * (1 - expectedRate)) / trials);
  if (se === 0) return null;
  return (successes / trials - expectedRate) / se;
}

export type SlopeFit = {
  slope: number;
  intercept: number;
  /** Standard error of the slope. */
  stdErr: number;
  /** slope / stdErr -- how many standard errors the trend sits from flat. */
  z: number;
  n: number;
};

/**
 * OLS plus the standard error of the slope, so a trend can be TESTED rather than
 * merely drawn.
 *
 * `linearTrend` above answers "what line fits these points"; every fit produces
 * one, including a fit through noise. This answers "is that line distinguishable
 * from flat", which is the only version an insight rule may act on. Needs three
 * points: with two, the residual variance is zero by construction and every
 * slope would look infinitely significant.
 */
export function slopeWithError(points: Array<{ x: number; y: number }>): SlopeFit | null {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  const n = pts.length;
  if (n < 3) return null;

  const mx = pts.reduce((a, p) => a + p.x, 0) / n;
  const my = pts.reduce((a, p) => a + p.y, 0) / n;

  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    const dx = p.x - mx;
    sxy += dx * (p.y - my);
    sxx += dx * dx;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = my - slope * mx;

  let sse = 0;
  for (const p of pts) {
    const resid = p.y - (slope * p.x + intercept);
    sse += resid * resid;
  }
  const stdErr = Math.sqrt(sse / (n - 2) / sxx);
  // A perfectly collinear series has no residual scatter. That is a property of
  // having few points, not evidence of a trend, so it scores zero rather than
  // dividing by zero into infinity.
  if (!Number.isFinite(stdErr) || stdErr === 0) {
    return { slope, intercept, stdErr: 0, z: 0, n };
  }
  return { slope, intercept, stdErr, z: slope / stdErr, n };
}

/**
 * Inverse standard normal CDF -- the z with `alpha` probability in the upper
 * tail. Acklam's rational approximation, |error| < 1.2e-9.
 *
 * Needed because the significance threshold is not a constant: it depends on how
 * many tests ran alongside a finding. Testing 34 exercises for a stall and taking
 * the best one at p<.05 finds a "stalled lift" in pure noise about four times in
 * five; the Bonferroni-corrected threshold this feeds is what prevents that.
 */
export function zCritical(alpha: number): number {
  if (!(alpha > 0 && alpha < 1)) return Infinity;
  // Two-tailed: put half the mass in each tail.
  const p = 1 - alpha / 2;
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969,
             138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887,
             66.8013118877197, -13.2806815528857];
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184,
             -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;

  if (p < pLow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > pHigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q /
    (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

/** Nice, human-readable axis ticks covering [min, max]. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const span = max - min;
  const rawStep = span / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + step * 1e-9; v += step) {
    // Guard against binary drift producing values like 0.30000000000000004.
    out.push(Number(v.toFixed(10)));
  }
  return out;
}
