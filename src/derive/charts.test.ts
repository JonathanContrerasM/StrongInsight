import { describe, it, expect } from 'vitest';
import {
  bucketKey,
  bucketRange,
  bucketBy,
  startOfWeek,
  daysBetween,
} from './buckets';
import {
  median,
  quantile,
  quantileThresholds,
  binIndex,
  rollingMean,
  rollingMedian,
  runningMax,
  segmentByGap,
  linearTrend,
  niceTicks,
  sortedFinite,
} from './stats';
import { volumeSeries, strengthSeries, sessionBests, smoothSessionBests, calendarDays, bodyweightVsAddedSeries } from './series';
import { balanceSeries, balanceVerdict, volumeMatrix } from './balance';
import { setPositionProfile, repDensity, loadRepDensity, habitMap, muscleGroup } from './profile';
import { cooccurrence, pickThreshold } from './cooccurrence';
import { volume } from './index';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta } from '../test/helpers';
import type { EnrichedSet } from '../model/effectiveLoad';

const BW = [{ date: '2024-01-01', kg: 80 }];

/** Build enriched sets from row specs, with metadata supplied per exercise. */
function build(
  rows: Parameters<typeof makeCsv>[0],
  metaMap: Record<string, ReturnType<typeof meta>>,
): EnrichedSet[] {
  return enrich(parseCsv(makeCsv(rows)).sets, metaMap, BW);
}

// --- bucketing ----------------------------------------------------------------

describe('time bucketing', () => {
  it('honours weekStartsOn', () => {
    // 2024-01-07 is a Sunday.
    const sunday = new Date(2024, 0, 7, 12);
    expect(startOfWeek(sunday, 0).getDate()).toBe(7); // week starts Sunday
    expect(startOfWeek(sunday, 1).getDate()).toBe(1); // week starts Monday
  });

  it('produces sortable keys', () => {
    const keys = [new Date(2024, 10, 5), new Date(2024, 0, 5), new Date(2025, 0, 5)]
      .map((d) => bucketKey(d, 'month'))
      .sort();
    expect(keys).toEqual(['2024-01', '2024-11', '2025-01']);
  });

  it('emits contiguous buckets with no gaps', () => {
    const range = bucketRange(new Date(2024, 0, 15), new Date(2024, 3, 2), 'month');
    expect(range.map((d) => bucketKey(d, 'month'))).toEqual([
      '2024-01',
      '2024-02',
      '2024-03',
      '2024-04',
    ]);
  });

  /**
   * Advancing a day with +86400000 ms silently drops or duplicates a day across a
   * DST transition. This asserts the calendar arithmetic is date-based.
   */
  it('counts days correctly across a DST transition', () => {
    // Late March covers the European spring-forward; late October the fall-back.
    const spring = bucketRange(new Date(2025, 2, 28), new Date(2025, 3, 2), 'day');
    expect(spring).toHaveLength(6);
    const autumn = bucketRange(new Date(2025, 9, 24), new Date(2025, 9, 29), 'day');
    expect(autumn).toHaveLength(6);
    expect(daysBetween(new Date(2025, 2, 28), new Date(2025, 3, 2))).toBe(5);
  });

  it('keeps an empty bucket between two populated ones', () => {
    const items = [{ date: new Date(2024, 0, 10) }, { date: new Date(2024, 2, 10) }];
    const buckets = bucketBy(items, (i) => i.date, 'month');
    expect(buckets).toHaveLength(3);
    expect(buckets[1]?.items).toEqual([]);
  });

  it('returns empty for empty input rather than throwing', () => {
    expect(bucketBy([], (i: { date: Date }) => i.date, 'week')).toEqual([]);
  });
});

// --- stats --------------------------------------------------------------------

describe('stats', () => {
  it('computes quantiles and thresholds', () => {
    const s = sortedFinite([1, 2, 3, 4, 5]);
    expect(quantile(s, 0)).toBe(1);
    expect(quantile(s, 1)).toBe(5);
    expect(quantile(s, 0.5)).toBe(3);
    expect(quantile([], 0.5)).toBeNull();
  });

  it('collapses thresholds when values are identical, rather than making empty bins', () => {
    expect(quantileThresholds([5, 5, 5, 5], 5)).toEqual([]);
    expect(quantileThresholds([], 5)).toEqual([]);
  });

  it('bins values against thresholds', () => {
    const t = [10, 20];
    expect(binIndex(5, t)).toBe(0);
    expect(binIndex(10, t)).toBe(0);
    expect(binIndex(15, t)).toBe(1);
    expect(binIndex(50, t)).toBe(2);
  });

  it('rolling median is centred and identity at window 1', () => {
    expect(rollingMedian([1, 2, 3], 1)).toEqual([1, 2, 3]);
    expect(rollingMedian([5, 5, 5], 3)).toEqual([5, 5, 5]);
  });

  /**
   * Protects the design decision. A deload is a one-sided outlier: a mean is
   * dragged down by it, a median is not. If someone "simplifies" the smoother to
   * a moving average later, this fails.
   */
  it('median resists deloads where mean does not', () => {
    // Steady 100s with a periodic 50 deload.
    const series = [100, 100, 50, 100, 100, 50, 100, 100, 50, 100, 100];
    const med = rollingMedian(series, 5);
    const avg = rollingMean(series, 5);
    const mid = 5;
    expect(med[mid]).toBe(100);
    expect(avg[mid] as number).toBeLessThan(95);
  });

  it('running max never decreases', () => {
    expect(runningMax([10, 5, 20, null, 15])).toEqual([10, 10, 20, 20, 20]);
  });

  it('segments a series across a long gap', () => {
    const pts = [
      { date: new Date(2024, 0, 1) },
      { date: new Date(2024, 0, 5) },
      { date: new Date(2024, 3, 1) },
    ];
    const segs = segmentByGap(pts, 28);
    expect(segs).toHaveLength(2);
    expect(segs[0]?.points).toHaveLength(2);
    expect(segs[1]?.points).toHaveLength(1);
    expect(segs[1]?.gapDaysBefore).toBeGreaterThan(28);
  });

  it('fits a trend and refuses when it cannot', () => {
    const t = linearTrend([
      { x: 0, y: 0 },
      { x: 1, y: 2 },
      { x: 2, y: 4 },
    ]);
    expect(t?.slope).toBeCloseTo(2, 6);
    expect(linearTrend([{ x: 1, y: 1 }])).toBeNull();
    // Zero variance in x has no defined slope.
    expect(linearTrend([{ x: 1, y: 1 }, { x: 1, y: 5 }])).toBeNull();
  });

  it('produces sane axis ticks', () => {
    expect(niceTicks(0, 100, 5).length).toBeGreaterThan(2);
    expect(niceTicks(5, 5)).toEqual([5]);
  });

  it('median handles empty and even-length input', () => {
    expect(median([])).toBeNull();
    expect(median([1, 3])).toBe(2);
  });
});

// --- series -------------------------------------------------------------------

describe('series', () => {
  const rows = [
    { date: '2024-01-01 10:00:00', exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
    { date: '2024-01-01 10:00:00', exercise: 'Squat (Barbell)', setOrder: 2, weight: 100, reps: 5 },
    { date: '2024-03-01 10:00:00', exercise: 'Squat (Barbell)', setOrder: 1, weight: 110, reps: 5 },
  ];
  const m = { 'Squat (Barbell)': meta('Squat (Barbell)') };

  it('conserves total volume across buckets', () => {
    const sets = build(rows, m);
    const series = volumeSeries(sets, { granularity: 'month' });
    const summed = series.reduce((n, p) => n + p.volume.volumeKg, 0);
    expect(summed).toBeCloseTo(volume(sets).volumeKg, 6);
  });

  it('keeps an empty month visible rather than dropping it', () => {
    const series = volumeSeries(build(rows, m), { granularity: 'month' });
    expect(series).toHaveLength(3);
    expect(series[1]?.setCount).toBe(0);
    expect(series[1]?.volume.volumeKg).toBe(0);
  });

  it('reports e1RM and heaviest separately', () => {
    const series = strengthSeries(build(rows, m), { granularity: 'month' });
    expect(series[0]?.heaviestKg).toBe(100);
    expect(series[2]?.heaviestKg).toBe(110);
    expect(series[1]?.heaviestKg).toBeNull();
  });

  it('summarises one entry per session, with the modal rep scheme', () => {
    const sets = build(rows, m);
    const bests = sessionBests(sets);
    expect(bests).toHaveLength(2);
    expect(bests[0]?.modalReps).toBe(5);
    expect(bests[0]?.heaviestKg).toBe(100);
    const smoothed = smoothSessionBests(bests, 3);
    expect(smoothed[1]?.prE1rmKg).toBeGreaterThanOrEqual(smoothed[0]?.prE1rmKg ?? 0);
  });

  it('reports per-session volume that matches the shared volume() rules', () => {
    const sets = build(rows, m);
    const bests = sessionBests(sets);
    // Two sets of 100kg x 5 in session one, one of 110kg x 5 in session two.
    expect(bests[0]?.volumeKg).toBeCloseTo(1000, 6);
    expect(bests[1]?.volumeKg).toBeCloseTo(550, 6);
    // Must not drift from the canonical helper.
    const total = bests.reduce((n, b) => n + b.volumeKg, 0);
    expect(total).toBeCloseTo(volume(sets).volumeKg, 6);
  });

  it('keeps a session whose sets are all unloaded, at zero volume', () => {
    // Empty-bar work: real sets, no quantifiable load.
    const unloaded = build(
      [
        { date: '2024-01-01 10:00:00', exercise: 'Squat (Barbell)', setOrder: 1, weight: 0, reps: 8 },
        { date: '2024-01-01 10:00:00', exercise: 'Squat (Barbell)', setOrder: 2, weight: 0, reps: 8 },
      ],
      m,
    );
    const bests = sessionBests(unloaded);
    expect(bests).toHaveLength(1);
    expect(bests[0]?.volumeKg).toBe(0);
    expect(bests[0]?.heaviestKg).toBeNull();
    expect(bests[0]?.setCount).toBe(2);
  });

  it('builds a dense calendar including rest days', () => {
    const days = calendarDays(build(rows, m));
    // 1 Jan to 1 Mar inclusive, every day present.
    expect(days.length).toBe(61);
    expect(days.filter((d) => d.hasWorkout)).toHaveLength(2);
    expect(days[1]?.hasWorkout).toBe(false);
  });

  it('splits bodyweight from added load', () => {
    const sets = build(
      [
        { date: '2024-01-01 10:00:00', exercise: 'Pull Up', setOrder: 1, weight: 0, reps: 10 },
        { date: '2024-01-01 10:00:00', exercise: 'Pull Up', setOrder: 2, weight: 20, reps: 5 },
      ],
      { 'Pull Up': meta('Pull Up', { loadType: 'bodyweight-plus' }) },
    );
    const series = bodyweightVsAddedSeries(sets, { granularity: 'month' });
    expect(series[0]?.bodyweightKg).toBeCloseTo(80, 6);
    expect(series[0]?.addedKg).toBeCloseTo(10, 6);
    expect(series[0]?.loadedSetCount).toBe(1);
  });
});

// --- balance ------------------------------------------------------------------

describe('balance', () => {
  const balanceMeta: Record<string, ReturnType<typeof meta>> = {
    Bench: meta('Bench', { pattern: 'horiz-push', primaryMuscle: 'chest' }),
    Row: meta('Row', { pattern: 'horiz-pull', primaryMuscle: 'back' }),
  };
  const balanceLookup = (n: string) => balanceMeta[n];

  const sets = build(
    [
      { date: '2024-01-01 10:00:00', exercise: 'Bench', setOrder: 1, weight: 100, reps: 10 },
      { date: '2024-01-01 10:00:00', exercise: 'Row', setOrder: 1, weight: 50, reps: 10 },
    ],
    balanceMeta,
  );

  it('computes a log2 ratio that is symmetric about zero', () => {
    const series = balanceSeries(sets, balanceLookup, { granularity: 'month' });
    // Pull volume is half of push volume.
    expect(series[0]?.pullPushRatio).toBeCloseTo(0.5, 6);
    expect(series[0]?.pullPushLog2).toBeCloseTo(-1, 6);

    // The mirror case must land the same distance the other side of zero.
    const mirrored = build(
      [
        { date: '2024-01-01 10:00:00', exercise: 'Bench', setOrder: 1, weight: 50, reps: 10 },
        { date: '2024-01-01 10:00:00', exercise: 'Row', setOrder: 1, weight: 100, reps: 10 },
      ],
      balanceMeta,
    );
    const mirroredSeries = balanceSeries(mirrored, balanceLookup, { granularity: 'month' });
    expect(mirroredSeries[0]?.pullPushLog2).toBeCloseTo(1, 6);
  });

  it('returns null rather than Infinity when a side is missing', () => {
    const onlyPush = build(
      [{ date: '2024-01-01 10:00:00', exercise: 'Bench', setOrder: 1, weight: 100, reps: 10 }],
      { Bench: meta('Bench', { pattern: 'horiz-push' }) },
    );
    const series = balanceSeries(onlyPush, () => meta('Bench', { pattern: 'horiz-push' }), {
      granularity: 'month',
    });
    expect(series[0]?.pullPushRatio).toBeNull();
    expect(series[0]?.pullPushLog2).toBeNull();
  });

  it('stays quiet on thin evidence', () => {
    const series = balanceSeries(sets, balanceLookup, { granularity: 'month' });
    // One bucket is not enough to accuse anyone of an imbalance.
    expect(balanceVerdict(series).flags).toEqual([]);
  });

  it('builds a dense matrix with unknown pinned last', () => {
    const withUnknown = build(
      [
        { date: '2024-01-01 10:00:00', exercise: 'Bench', setOrder: 1, weight: 100, reps: 10 },
        { date: '2024-01-01 10:00:00', exercise: 'Mystery', setOrder: 1, weight: 10, reps: 10 },
      ],
      {
        Bench: meta('Bench', { primaryMuscle: 'chest' }),
        Mystery: meta('Mystery', { primaryMuscle: 'unknown' }),
      },
    );
    const mx = volumeMatrix(
      withUnknown,
      (n) => (n === 'Bench' ? meta('Bench', { primaryMuscle: 'chest' }) : meta('Mystery')),
      { granularity: 'month', by: 'muscle' },
    );
    expect(mx.groups[mx.groups.length - 1]).toBe('unknown');
    const total = mx.cells.flat().reduce((n, c) => n + c.volumeKg, 0);
    expect(total).toBeCloseTo(volume(withUnknown).volumeKg, 6);
  });
});

// --- profile ------------------------------------------------------------------

describe('set position profile', () => {
  /** The reference corpus ramps: load rises with set index. */
  it('recognises a ramping pattern rather than calling it fatigue', () => {
    const rows = [20, 40, 60, 80].flatMap((w, i) =>
      [0, 1].map(() => ({
        date: '2024-01-0' + (i + 1) + ' 10:00:00',
        exercise: 'Squat (Barbell)',
        setOrder: 0,
        weight: w,
        reps: 8,
      })),
    );
    // Rebuild with proper per-session set ordering.
    const csvRows = [1, 2, 3, 4].map((n) => ({
      date: '2024-01-01 10:00:00',
      exercise: 'Squat (Barbell)',
      setOrder: n,
      weight: n * 20,
      reps: 8,
    }));
    const second = csvRows.map((r) => ({ ...r, date: '2024-01-08 10:00:00' }));
    void rows;
    const sets = build([...csvRows, ...second], { 'Squat (Barbell)': meta('Squat (Barbell)') });
    const profile = setPositionProfile(sets);
    expect(profile.shape).toBe('ramping');
    expect(profile.points[0]?.meanLoadKg).toBeLessThan(profile.points[3]?.meanLoadKg ?? 0);
  });

  it('recognises genuine fatigue when load is held constant', () => {
    const mk = (date: string) =>
      [12, 11, 9, 7].map((reps, i) => ({
        date,
        exercise: 'Push Up',
        setOrder: i + 1,
        weight: 0,
        reps,
      }));
    const sets = build([...mk('2024-01-01 10:00:00'), ...mk('2024-01-08 10:00:00')], {
      'Push Up': meta('Push Up', { loadType: 'bodyweight' }),
    });
    expect(setPositionProfile(sets).shape).toBe('fatiguing');
  });

  it('refuses to characterise thin data', () => {
    const sets = build(
      [{ date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 1, weight: 50, reps: 5 }],
      { X: meta('X') },
    );
    expect(setPositionProfile(sets).shape).toBe('insufficient-data');
  });
});

describe('distributions', () => {
  it('keeps one bar per rep count, preserving multi-modality', () => {
    const sets = build(
      [
        { date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 1, weight: 50, reps: 5 },
        { date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 2, weight: 50, reps: 10 },
        { date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 3, weight: 50, reps: 10 },
      ],
      { X: meta('X') },
    );
    expect(repDensity(sets)).toEqual([
      { reps: 5, setCount: 1 },
      { reps: 10, setCount: 2 },
    ]);
  });

  it('derives load bins from the data rather than a fixed step', () => {
    const sets = build(
      [
        { date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 1, weight: 20, reps: 5 },
        { date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 2, weight: 200, reps: 5 },
      ],
      { X: meta('X') },
    );
    const d = loadRepDensity(sets);
    expect(d.loadEdges[0]).toBe(20);
    expect(d.loadEdges[d.loadEdges.length - 1]).toBe(200);
    expect(d.cells.reduce((n, c) => n + c.setCount, 0)).toBe(2);
  });

  it('returns an empty-but-valid shape when nothing is quantifiable', () => {
    const sets = build(
      [{ date: '2024-01-01 10:00:00', exercise: 'Plank', setOrder: 1, weight: 0, reps: 0, seconds: 60 }],
      { Plank: meta('Plank', { loadType: 'duration' }) },
    );
    const d = loadRepDensity(sets);
    expect(d.cells).toEqual([]);
    expect(d.maxCount).toBe(0);
  });

  it('flags an export with no time-of-day rather than drawing a midnight spike', () => {
    const midnightOnly = build(
      [{ date: '2024-01-01 00:00:00', exercise: 'X', setOrder: 1, weight: 50, reps: 5 }],
      { X: meta('X') },
    );
    expect(habitMap(midnightOnly).hasTimeOfDay).toBe(false);

    const evening = build(
      [{ date: '2024-01-01 18:00:00', exercise: 'X', setOrder: 1, weight: 50, reps: 5 }],
      { X: meta('X') },
    );
    const h = habitMap(evening);
    expect(h.hasTimeOfDay).toBe(true);
    expect(h.hourMin).toBe(18);
  });

  it('folds muscles into a small number of groups', () => {
    expect(muscleGroup('chest')).toBe('push');
    expect(muscleGroup('lats')).toBe('pull');
    expect(muscleGroup('quads')).toBe('legs');
    expect(muscleGroup('abs')).toBe('core');
    expect(muscleGroup('unknown')).toBe('unknown');
  });
});

// --- co-occurrence ------------------------------------------------------------

describe('co-occurrence and split recovery', () => {
  /** Three disjoint groups over many sessions, with light contamination. */
  function plantedRows() {
    const groups = [
      ['A1', 'A2', 'A3'],
      ['B1', 'B2', 'B3'],
      ['C1', 'C2', 'C3'],
    ];
    const rows: Parameters<typeof makeCsv>[0] = [];
    for (let day = 0; day < 30; day++) {
      const g = groups[day % 3] as string[];
      const date =
        '2024-' + String(Math.floor(day / 28) + 1).padStart(2, '0') + '-' +
        String((day % 28) + 1).padStart(2, '0') + ' 10:00:00';
      g.forEach((ex, i) => rows.push({ date, exercise: ex, setOrder: i + 1, weight: 50, reps: 5 }));
    }
    return rows;
  }

  const plantedMeta = Object.fromEntries(
    ['A1', 'A2', 'A3', 'B1', 'B2', 'B3', 'C1', 'C2', 'C3'].map((n) => [n, meta(n)]),
  );

  it('recovers a planted three-group structure', () => {
    const sets = build(plantedRows(), plantedMeta);
    const r = cooccurrence(sets, (n) => plantedMeta[n]);
    expect(r.clusters).toHaveLength(3);
    expect(r.wellSeparated).toBe(true);
    // Compare as a partition; cluster ids are arbitrary.
    const partition = r.clusters.map((c) => c.members.slice().sort().join(',')).sort();
    expect(partition).toEqual(['A1,A2,A3', 'B1,B2,B3', 'C1,C2,C3']);
  });

  it('is deterministic under input reordering', () => {
    const sets = build(plantedRows(), plantedMeta);
    const a = cooccurrence(sets, (n) => plantedMeta[n]);
    const b = cooccurrence(sets.slice().reverse(), (n) => plantedMeta[n]);
    expect(b.order).toEqual(a.order);
    expect(b.clusters.map((c) => c.members)).toEqual(a.clusters.map((c) => c.members));
    expect(b.silhouette).toBeCloseTo(a.silhouette, 12);
  });

  it('reports weak structure instead of inventing a routine', () => {
    // Every session identical: there is no split to find.
    const rows: Parameters<typeof makeCsv>[0] = [];
    for (let day = 1; day <= 20; day++) {
      ['X', 'Y', 'Z'].forEach((ex, i) =>
        rows.push({
          date: '2024-01-' + String(day).padStart(2, '0') + ' 10:00:00',
          exercise: ex,
          setOrder: i + 1,
          weight: 50,
          reps: 5,
        }),
      );
    }
    const m = { X: meta('X'), Y: meta('Y'), Z: meta('Z') };
    const r = cooccurrence(build(rows, m), (n) => m[n as keyof typeof m]);
    expect(r.wellSeparated).toBe(false);
  });

  it('cosine is less frequency-biased than Jaccard', () => {
    // B appears in half of A's sessions but ALWAYS with A.
    const rows: Parameters<typeof makeCsv>[0] = [];
    for (let day = 1; day <= 20; day++) {
      const date = '2024-01-' + String(day).padStart(2, '0') + ' 10:00:00';
      rows.push({ date, exercise: 'A', setOrder: 1, weight: 50, reps: 5 });
      if (day <= 10) rows.push({ date, exercise: 'B', setOrder: 2, weight: 50, reps: 5 });
    }
    const m = { A: meta('A'), B: meta('B') };
    const sets = build(rows, m);
    const look = (n: string) => m[n as keyof typeof m];

    const cos = cooccurrence(sets, look, { minAppearances: 1, similarity: 'cosine' });
    const jac = cooccurrence(sets, look, { minAppearances: 1, similarity: 'jaccard' });
    const cosVal = cos.similarity[0]?.[1] ?? 0;
    const jacVal = jac.similarity[0]?.[1] ?? 0;

    expect(jacVal).toBeCloseTo(0.5, 6);
    expect(cosVal).toBeCloseTo(Math.SQRT1_2, 6);
    expect(cosVal).toBeGreaterThan(jacVal);
  });

  it('excludes rare exercises rather than dropping them silently', () => {
    const sets = build(
      [
        ...plantedRows(),
        { date: '2024-02-27 10:00:00', exercise: 'OneOff', setOrder: 1, weight: 5, reps: 5 },
      ],
      { ...plantedMeta, OneOff: meta('OneOff') },
    );
    const r = cooccurrence(sets, (n) => plantedMeta[n] ?? meta(n), { minAppearances: 3 });
    const accounted = r.order.length + r.tooRare.length;
    expect(accounted).toBe(10);
    expect(r.tooRare.map((t) => t.name)).toContain('OneOff');
  });

  it('degrades without throwing on tiny or empty input', () => {
    expect(cooccurrence([], () => undefined).clusters).toEqual([]);
    const one = build(
      [{ date: '2024-01-01 10:00:00', exercise: 'X', setOrder: 1, weight: 50, reps: 5 }],
      { X: meta('X') },
    );
    const r = cooccurrence(one, (n) => meta(n));
    expect(r.clusters).toEqual([]);
    expect(r.wellSeparated).toBe(false);
  });

  it('picks a threshold from the data rather than assuming one', () => {
    const sets = build(plantedRows(), plantedMeta);
    const t = pickThreshold(sets, (n) => plantedMeta[n]);
    expect(t).toBeGreaterThanOrEqual(2);
  });
});
