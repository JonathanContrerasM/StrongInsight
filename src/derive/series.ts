import type { EnrichedSet } from '../model/effectiveLoad';
import { e1rm, volume, type VolumeResult } from './index';
import { bucketBy, type Granularity, type WeekStart } from './buckets';
import { linearTrend, rollingMedian, runningMax } from './stats';

/**
 * Time series over EnrichedSet[]. All pure.
 *
 * A note that shapes this whole module: in real data the *heaviest set per
 * period* is noisy, because ramp-up sets and deload weeks sit in the same bucket
 * as top sets. In the reference corpus monthly top-set squat weight bounces
 * between 50 and 110 kg. Best-e1RM per period is the smoother signal, so charts
 * show both and never present the raw maximum alone.
 */

export type SeriesOptions = {
  granularity: Granularity;
  weekStartsOn?: WeekStart;
};

export type VolumePoint = {
  key: string;
  start: Date;
  volume: VolumeResult;
  setCount: number;
  workoutCount: number;
};

export function volumeSeries(sets: EnrichedSet[], opts: SeriesOptions): VolumePoint[] {
  return bucketBy(sets, (s) => s.date, opts.granularity, opts.weekStartsOn ?? 1).map((b) => ({
    key: b.key,
    start: b.start,
    volume: volume(b.items),
    setCount: b.items.length,
    workoutCount: new Set(b.items.map((s) => s.workoutId)).size,
  }));
}

export type StrengthPoint = {
  key: string;
  start: Date;
  /** Best estimated 1RM in the bucket, null when nothing was quantifiable. */
  bestE1rmKg: number | null;
  /** Smoothed best e1RM; null where the window had no data. */
  smoothedE1rmKg: number | null;
  /** Heaviest actual effective load. Noisy by nature -- see module note. */
  heaviestKg: number | null;
  setCount: number;
};

/**
 * Strength progression. Returns e1RM and heaviest load side by side because they
 * answer different questions: e1RM tracks capability, heaviest tracks what was
 * actually put on the bar.
 */
export function strengthSeries(
  sets: EnrichedSet[],
  opts: SeriesOptions & { smoothWindow?: number },
): StrengthPoint[] {
  const buckets = bucketBy(sets, (s) => s.date, opts.granularity, opts.weekStartsOn ?? 1);

  const raw = buckets.map((b) => {
    let bestE1rm: number | null = null;
    let heaviest: number | null = null;
    for (const s of b.items) {
      const est = e1rm(s);
      if (est !== null && (bestE1rm === null || est > bestE1rm)) bestE1rm = est;
      // An unloaded (empty-bar) set carries no quantifiable load.
      const load = s.isUnloaded ? null : s.effectiveLoadKg;
      if (load !== null && load > 0 && (heaviest === null || load > heaviest)) heaviest = load;
    }
    return { key: b.key, start: b.start, bestE1rm, heaviest, setCount: b.items.length };
  });

  // Median, not mean: a deload bucket is a one-sided outlier that would drag a
  // mean down exactly when the trend matters.
  const smoothed = rollingMedian(
    raw.map((p) => p.bestE1rm),
    opts.smoothWindow ?? 3,
  );

  return raw.map((p, i) => ({
    key: p.key,
    start: p.start,
    bestE1rmKg: p.bestE1rm,
    smoothedE1rmKg: smoothed[i] ?? null,
    heaviestKg: p.heaviest,
    setCount: p.setCount,
  }));
}

export type SessionBest = {
  workoutId: string;
  date: Date;
  bestE1rmKg: number | null;
  heaviestKg: number | null;
  /**
   * Total volume for this exercise in this session.
   *
   * Deliberately a separate series from `heaviestKg`, because the two genuinely
   * disagree: in the reference corpus the highest-volume squat session was done
   * at only 60 kg, while a 100 kg session carried less total work. Peak effort
   * and accumulated work are different questions.
   */
  volumeKg: number;
  /** The session's dominant rep count -- a scheme change explains many "drops". */
  modalReps: number | null;
  setCount: number;
  /** Sets that could not contribute an e1RM (over the rep cap, unloaded, no load). */
  skippedSets: number;
};

/**
 * Best effort per SESSION rather than per calendar period.
 *
 * This is the anti-noise decision. Bucketing by month mixes ramp-up sets, deload
 * weeks and top sets together, which is why monthly top-set weight in the
 * reference corpus swings between 50 and 110 kg and looks like pure noise.
 * Indexing by session, then smoothing across sessions, keeps a three-week layoff
 * from being filled with imaginary progress.
 */
export function sessionBests(sets: EnrichedSet[]): SessionBest[] {
  const byWorkout = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const list = byWorkout.get(s.workoutId);
    if (list) list.push(s);
    else byWorkout.set(s.workoutId, [s]);
  }

  const out: SessionBest[] = [];
  for (const [workoutId, list] of byWorkout) {
    const first = list[0];
    if (!first) continue;

    let bestE1rm: number | null = null;
    let heaviest: number | null = null;
    let skipped = 0;
    const repCounts = new Map<number, number>();
    let date = first.date;

    for (const s of list) {
      if (s.date < date) date = s.date;
      const est = e1rm(s);
      if (est === null) skipped++;
      else if (bestE1rm === null || est > bestE1rm) bestE1rm = est;

      const load = s.isUnloaded ? null : s.effectiveLoadKg;
      if (load !== null && load > 0 && (heaviest === null || load > heaviest)) heaviest = load;

      if (s.reps !== null && s.reps > 0) {
        const r = Math.round(s.reps);
        repCounts.set(r, (repCounts.get(r) ?? 0) + 1);
      }
    }

    const modal = [...repCounts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];

    out.push({
      workoutId,
      date,
      bestE1rmKg: bestE1rm,
      heaviestKg: heaviest,
      // Uses the shared volume() helper so the exclusion rules (unloaded sets,
      // unresolvable load, zero reps) match every other volume figure in the app.
      volumeKg: volume(list).volumeKg,
      modalReps: modal ? modal[0] : null,
      setCount: list.length,
      skippedSets: skipped,
    });
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}

export type SmoothedSessionBest = SessionBest & {
  smoothedE1rmKg: number | null;
  /** Personal best to date -- what users usually mean by "getting stronger". */
  prE1rmKg: number | null;
};

export function smoothSessionBests(points: SessionBest[], window = 5): SmoothedSessionBest[] {
  const values = points.map((p) => p.bestE1rmKg);
  const smoothed = rollingMedian(values, window);
  const pr = runningMax(values);
  return points.map((p, i) => ({
    ...p,
    smoothedE1rmKg: smoothed[i] ?? null,
    prE1rmKg: pr[i] ?? null,
  }));
}

/** Least-squares trend through the non-empty e1RM points, in kg per day. */
export function strengthTrend(points: StrengthPoint[]): { slopeKgPerDay: number; at(d: Date): number } | null {
  const pts = points
    .filter((p) => p.bestE1rmKg !== null)
    .map((p) => ({ x: p.start.getTime(), y: p.bestE1rmKg as number }));
  const line = linearTrend(pts);
  if (!line) return null;
  return {
    slopeKgPerDay: line.slope * 86400000,
    at: (d: Date) => line.at(d.getTime()),
  };
}

export type LoadSplitPoint = {
  key: string;
  start: Date;
  /** Mean bodyweight component of effective load. */
  bodyweightKg: number | null;
  /** Mean added (or, for assisted work, negative) component. */
  addedKg: number | null;
  totalKg: number | null;
  setCount: number;
  loadedSetCount: number;
};

/**
 * The bodyweight-vs-added-load story, which a raw weight chart makes invisible:
 * 437 of 623 Pull Up sets in the reference corpus are logged at weight 0, yet
 * they carry the athlete's full bodyweight.
 *
 * Only meaningful for bodyweight-relative load types; other sets are skipped.
 */
export function bodyweightVsAddedSeries(sets: EnrichedSet[], opts: SeriesOptions): LoadSplitPoint[] {
  const relevant = sets.filter(
    (s) => s.loadType === 'bodyweight' || s.loadType === 'bodyweight-plus' || s.loadType === 'assisted',
  );

  return bucketBy(relevant, (s) => s.date, opts.granularity, opts.weekStartsOn ?? 1).map((b) => {
    let bwSum = 0;
    let addedSum = 0;
    let n = 0;
    let loaded = 0;

    for (const s of b.items) {
      if (s.effectiveLoadKg === null) continue;
      const added = s.loadType === 'assisted' ? -(s.weightKg ?? 0) : (s.weightKg ?? 0);
      // effectiveLoad already folded bodyweight in; recover the base component.
      const base = s.effectiveLoadKg - added;
      bwSum += base;
      addedSum += added;
      n++;
      if (added !== 0) loaded++;
    }

    return {
      key: b.key,
      start: b.start,
      bodyweightKg: n === 0 ? null : bwSum / n,
      addedKg: n === 0 ? null : addedSum / n,
      totalKg: n === 0 ? null : (bwSum + addedSum) / n,
      setCount: b.items.length,
      loadedSetCount: loaded,
    };
  });
}

export type DayCell = {
  date: Date;
  key: string;
  hasWorkout: boolean;
  workoutCount: number;
  setCount: number;
  volumeKg: number;
  exercises: string[];
  durationSec: number;
};

/**
 * Every calendar day between the first and last session, with no gaps.
 *
 * The dense range is the point: rest days must be drawn, because a calendar that
 * only renders trained days silently compresses a layoff out of existence.
 */
export function calendarDays(
  sets: EnrichedSet[],
  durations: Map<string, number> = new Map(),
): DayCell[] {
  if (sets.length === 0) return [];

  let min = sets[0]!.date;
  let max = sets[0]!.date;
  for (const s of sets) {
    if (s.date < min) min = s.date;
    if (s.date > max) max = s.date;
  }

  const byDay = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const k = dayKey(s.date);
    const list = byDay.get(k);
    if (list) list.push(s);
    else byDay.set(k, [s]);
  }

  const out: DayCell[] = [];
  const cur = new Date(min.getFullYear(), min.getMonth(), min.getDate());
  const end = new Date(max.getFullYear(), max.getMonth(), max.getDate());

  for (let guard = 0; cur.getTime() <= end.getTime() && guard < 20000; guard++) {
    const key = dayKey(cur);
    const items = byDay.get(key) ?? [];
    const workoutIds = new Set(items.map((s) => s.workoutId));
    let durationSec = 0;
    for (const id of workoutIds) durationSec += durations.get(id) ?? 0;

    out.push({
      date: new Date(cur.getTime()),
      key,
      hasWorkout: items.length > 0,
      workoutCount: workoutIds.size,
      setCount: items.length,
      volumeKg: volume(items).volumeKg,
      exercises: [...new Set(items.map((s) => s.canonicalName))],
      durationSec,
    });
    // setDate rather than +86400000: epoch arithmetic drops or duplicates a day
    // across a DST boundary, and this range spans several.
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export type WorkoutPoint = {
  workoutId: string;
  date: Date;
  volumeKg: number;
  setCount: number;
  exerciseCount: number;
  durationSec: number;
};

/** One point per session, for the calendar and for session-level scatter. */
export function workoutSeries(
  sets: EnrichedSet[],
  durations: Map<string, number> = new Map(),
): WorkoutPoint[] {
  const byWorkout = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const list = byWorkout.get(s.workoutId);
    if (list) list.push(s);
    else byWorkout.set(s.workoutId, [s]);
  }

  const out: WorkoutPoint[] = [];
  for (const [workoutId, list] of byWorkout) {
    const first = list[0];
    if (!first) continue;
    out.push({
      workoutId,
      date: first.date,
      volumeKg: volume(list).volumeKg,
      setCount: list.length,
      exerciseCount: new Set(list.map((s) => s.canonicalName)).size,
      durationSec: durations.get(workoutId) ?? 0,
    });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
