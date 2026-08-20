import type { EnrichedSet } from '../model/effectiveLoad';
import type { ExerciseMeta, MovementPattern, Muscle } from '../model/types';
import { volume } from './index';
import { bucketBy, type Granularity, type WeekStart } from './buckets';

/**
 * Muscle- and pattern-grouped aggregates.
 *
 * These depend on metadata that may still be an unconfirmed guess, so every
 * result carries the confirmed/unconfirmed split. Iteration 1 promised that an
 * unverified tag is visible wherever it appears; these counts are how the charts
 * keep that promise. Nothing is ever silently dropped -- work whose metadata is
 * unknown lands in an explicit 'unknown' bucket.
 */

export type MetaLookup = (name: string) => ExerciseMeta | undefined;

export type GroupBy = 'muscle' | 'pattern';

export function groupKeyOf(set: EnrichedSet, meta: MetaLookup, by: GroupBy): string {
  const m = meta(set.canonicalName);
  if (!m) return 'unknown';
  return by === 'muscle' ? m.primaryMuscle : m.pattern;
}

export type MatrixCell = {
  /** Volume attributable to this group in this bucket. */
  volumeKg: number;
  setCount: number;
  /** Sets in this cell whose metadata is still an unconfirmed guess. */
  unconfirmedSets: number;
};

export type VolumeMatrix = {
  /** Row keys: muscles or patterns, always including 'unknown' when present. */
  groups: string[];
  /** Column buckets, contiguous with no gaps. */
  buckets: Array<{ key: string; start: Date }>;
  /** cells[groupIndex][bucketIndex] */
  cells: MatrixCell[][];
  /** Row totals, for sorting. */
  groupTotals: number[];
  /** Column totals, so a cell can be shown as a share of its bucket. */
  bucketTotals: number[];
  maxCell: number;
  totalSets: number;
  unconfirmedSets: number;
};

/**
 * The muscle x time (or pattern x time) heatmap source.
 * Buckets are contiguous, so a training break shows as empty columns rather than
 * being compressed out of the axis.
 */
export function volumeMatrix(
  sets: EnrichedSet[],
  meta: MetaLookup,
  opts: { granularity: Granularity; weekStartsOn?: WeekStart; by: GroupBy },
): VolumeMatrix {
  const buckets = bucketBy(sets, (s) => s.date, opts.granularity, opts.weekStartsOn ?? 1);

  const groupSet = new Set<string>();
  for (const s of sets) groupSet.add(groupKeyOf(s, meta, opts.by));
  const groups = [...groupSet].sort((a, b) => {
    // 'unknown' always sorts last so it reads as a residual, not a category.
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return a.localeCompare(b);
  });

  const gi = new Map(groups.map((g, i) => [g, i]));
  const cells: MatrixCell[][] = groups.map(() =>
    buckets.map(() => ({ volumeKg: 0, setCount: 0, unconfirmedSets: 0 })),
  );

  let totalSets = 0;
  let unconfirmedSets = 0;

  buckets.forEach((b, bi) => {
    for (const s of b.items) {
      const idx = gi.get(groupKeyOf(s, meta, opts.by));
      if (idx === undefined) continue;
      const row = cells[idx];
      const cell = row?.[bi];
      if (!cell) continue;
      // volume() applies the exclusion rules (unloaded, no reps, unquantifiable).
      cell.volumeKg += volume([s]).volumeKg;
      cell.setCount++;
      totalSets++;
      if (!s.metaConfirmed) {
        cell.unconfirmedSets++;
        unconfirmedSets++;
      }
    }
  });

  const groupTotals = cells.map((row) => row.reduce((n, c) => n + c.volumeKg, 0));
  const bucketTotals = buckets.map((_, bi) => cells.reduce((n, row) => n + (row[bi]?.volumeKg ?? 0), 0));
  const maxCell = cells.reduce(
    (mx, row) => row.reduce((m, c) => (c.volumeKg > m ? c.volumeKg : m), mx),
    0,
  );

  return {
    groups,
    buckets: buckets.map((b) => ({ key: b.key, start: b.start })),
    cells,
    groupTotals,
    bucketTotals,
    maxCell,
    totalSets,
    unconfirmedSets,
  };
}

// --- push / pull / upper / lower balance --------------------------------------

const PUSH_PATTERNS: MovementPattern[] = ['horiz-push', 'vert-push'];
const PULL_PATTERNS: MovementPattern[] = ['horiz-pull', 'vert-pull'];
const LOWER_PATTERNS: MovementPattern[] = ['squat', 'hinge', 'lunge'];

const LOWER_MUSCLES: Muscle[] = ['quads', 'hamstrings', 'glutes', 'calves', 'adductors', 'abductors'];

export type BalancePoint = {
  key: string;
  start: Date;
  pushKg: number;
  pullKg: number;
  lowerKg: number;
  upperKg: number;
  otherKg: number;
  /** pull / push. 1 is balanced; null when either side is absent. */
  pullPushRatio: number | null;
  /** lower / upper. */
  lowerUpperRatio: number | null;
  /**
   * log2 of the ratios. THIS is what charts should plot.
   *
   * On a raw ratio axis a 2:1 imbalance sits at 2.0 while the equal-and-opposite
   * 1:2 sits at 0.5, so half the chart is squashed into [0,1] and the two read as
   * wildly different magnitudes. On a log2 axis they are symmetric about 0, which
   * is the only honest way to show a two-sided ratio.
   */
  pullPushLog2: number | null;
  lowerUpperLog2: number | null;
  unconfirmedSets: number;
  setCount: number;
};

/**
 * Push/pull and upper/lower balance over time.
 *
 * Ratios are null rather than 0 or Infinity when a side is missing, so a chart
 * shows a gap instead of implying a catastrophic imbalance from one empty week.
 */
export function balanceSeries(
  sets: EnrichedSet[],
  meta: MetaLookup,
  opts: { granularity: Granularity; weekStartsOn?: WeekStart },
): BalancePoint[] {
  return bucketBy(sets, (s) => s.date, opts.granularity, opts.weekStartsOn ?? 1).map((b) => {
    let pushKg = 0;
    let pullKg = 0;
    let lowerKg = 0;
    let upperKg = 0;
    let otherKg = 0;
    let unconfirmedSets = 0;

    for (const s of b.items) {
      const m = meta(s.canonicalName);
      const v = volume([s]).volumeKg;
      if (!s.metaConfirmed) unconfirmedSets++;
      if (!m) {
        otherKg += v;
        continue;
      }

      if (PUSH_PATTERNS.includes(m.pattern)) pushKg += v;
      else if (PULL_PATTERNS.includes(m.pattern)) pullKg += v;

      const isLower = LOWER_PATTERNS.includes(m.pattern) || LOWER_MUSCLES.includes(m.primaryMuscle);
      if (isLower) lowerKg += v;
      else if (m.pattern !== 'unknown') upperKg += v;
      else otherKg += v;
    }

    // null rather than 0 or Infinity when a side is absent: a chart must show a
    // gap, not imply a catastrophic imbalance from one empty week.
    const pullPushRatio = pushKg > 0 && pullKg > 0 ? pullKg / pushKg : null;
    const lowerUpperRatio = upperKg > 0 && lowerKg > 0 ? lowerKg / upperKg : null;

    return {
      key: b.key,
      start: b.start,
      pushKg,
      pullKg,
      lowerKg,
      upperKg,
      otherKg,
      pullPushRatio,
      lowerUpperRatio,
      pullPushLog2: pullPushRatio === null ? null : Math.log2(pullPushRatio),
      lowerUpperLog2: lowerUpperRatio === null ? null : Math.log2(lowerUpperRatio),
      unconfirmedSets,
      setCount: b.items.length,
    };
  });
}

export type BalanceVerdict = {
  medianPullPush: number | null;
  medianLowerUpper: number | null;
  /** Human-readable flags, empty when nothing is off. */
  flags: string[];
};

/**
 * Summary judgement over a balance series. Deliberately conservative: it only
 * speaks when there is enough data, and it describes rather than prescribes.
 */
export function balanceVerdict(points: BalancePoint[]): BalanceVerdict {
  const pp = points.map((p) => p.pullPushRatio).filter((v): v is number => v !== null);
  const lu = points.map((p) => p.lowerUpperRatio).filter((v): v is number => v !== null);

  const med = (xs: number[]): number | null => {
    if (xs.length === 0) return null;
    const s = xs.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
  };

  const medianPullPush = med(pp);
  const medianLowerUpper = med(lu);
  const flags: string[] = [];

  // Require a few periods before saying anything, or one odd week shouts.
  if (medianPullPush !== null && pp.length >= 4) {
    if (medianPullPush < 0.6) flags.push('Pull volume is well below push volume');
    else if (medianPullPush > 1.8) flags.push('Push volume is well below pull volume');
  }
  if (medianLowerUpper !== null && lu.length >= 4) {
    if (medianLowerUpper < 0.4) flags.push('Lower-body volume is well below upper-body volume');
    else if (medianLowerUpper > 2.5) flags.push('Upper-body volume is well below lower-body volume');
  }

  return { medianPullPush, medianLowerUpper, flags };
}
