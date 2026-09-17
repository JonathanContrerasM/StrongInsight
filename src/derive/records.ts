import { loadParts, type EnrichedSet, type LoadParts } from '../model/effectiveLoad';
import { byExercise, e1rm } from './index';
import { bucketKey, bucketRange, type Granularity, type WeekStart } from './buckets';

/**
 * Personal records, as events: WHEN each one happened, not just the current
 * best. Pure, like the rest of derive/.
 *
 * Three kinds, because "a PR" means three different things to a lifter and the
 * app should not pick one on their behalf:
 *
 *   e1rm          estimated 1RM beat the previous best -- capability
 *   load          more effective load than ever before -- what went on the bar
 *   reps-at-load  more reps at a load already lifted before -- the rep PR
 *
 * The one rule that keeps this honest: AN EXERCISE'S FIRST SESSION SETS NO
 * RECORDS. There is nothing to beat, and without the rule every lift would
 * open with three PRs and a "PRs per month" chart would be a chart of when
 * exercises were first tried. Ties are not records either.
 */

export const RECORD_KINDS = ['e1rm', 'load', 'reps-at-load'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export type RecordEvent = {
  /** Stable across runs: exercise, kind and the set that did it. */
  id: string;
  kind: RecordKind;
  /** Canonical name. */
  exercise: string;
  workoutId: string;
  setId: string;
  date: Date;
  /** kg for e1rm and load; reps for reps-at-load. */
  value: number;
  /** What was beaten. */
  previous: number;
  /** For reps-at-load: the load the reps were done at. */
  loadKg?: number;
  /** Bodyweight and added load of the record's set, on a bodyweight-relative lift. */
  parts: LoadParts | null;
  /**
   * True on a load or e1RM record of a bodyweight-relative movement, where the
   * effective load moves with the bodyweight history. It is still a record by
   * the app's own load model, but the copy should say where it came from.
   */
  bodyweightDriven: boolean;
};

/** Loads within half a kilo are the same load. Strong logs 0.25 kg plates on some stacks. */
function loadKey(kg: number): number {
  return Math.round(kg * 2) / 2;
}

/** A set that can hold a record at all. Warm-ups and empty-bar sets cannot. */
function eligible(s: EnrichedSet): boolean {
  if (s.setKind === 'warmup') return false;
  if (s.isUnloaded) return false;
  if (s.effectiveLoadKg === null || s.effectiveLoadKg <= 0) return false;
  return true;
}

function isBodyweightRelative(s: EnrichedSet): boolean {
  return s.loadType === 'bodyweight' || s.loadType === 'bodyweight-plus' || s.loadType === 'assisted';
}

/** Sessions of one exercise in date order, each with its sets. */
function sessionsOf(sets: EnrichedSet[]): Array<{ workoutId: string; date: Date; sets: EnrichedSet[] }> {
  const by = new Map<string, { workoutId: string; date: Date; sets: EnrichedSet[] }>();
  for (const s of sets) {
    const g = by.get(s.workoutId);
    if (g) {
      g.sets.push(s);
      if (s.date < g.date) g.date = s.date;
    } else by.set(s.workoutId, { workoutId: s.workoutId, date: s.date, sets: [s] });
  }
  return [...by.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Every record in the corpus, ascending by date. */
export function records(sets: EnrichedSet[]): RecordEvent[] {
  const out: RecordEvent[] = [];

  for (const [exercise, list] of byExercise(sets)) {
    const sessions = sessionsOf(list.filter(eligible));
    if (sessions.length < 2) continue;

    // An object rather than two `let`s: `absorb` below mutates them from a
    // closure, and TypeScript narrows a closed-over `let` to its initial null.
    const best: { e1rm: number | null; load: number | null } = { e1rm: null, load: null };
    /** Best reps at each load, keyed by loadKey. Only loads from PRIOR sessions count. */
    const bestReps = new Map<number, number>();

    const absorb = (session: { sets: EnrichedSet[] }) => {
      for (const s of session.sets) {
        const est = e1rm(s);
        if (est !== null && (best.e1rm === null || est > best.e1rm)) best.e1rm = est;
        const load = s.effectiveLoadKg as number;
        if (best.load === null || load > best.load) best.load = load;
        if (s.reps !== null && s.reps > 0) {
          const k = loadKey(load);
          const prev = bestReps.get(k);
          if (prev === undefined || s.reps > prev) bestReps.set(k, s.reps);
        }
      }
    };

    // The first session is the baseline, and only that.
    absorb(sessions[0] as (typeof sessions)[number]);

    for (let i = 1; i < sessions.length; i++) {
      const session = sessions[i] as (typeof sessions)[number];

      // Evaluate the whole session against the state BEFORE it, then absorb it,
      // so two sets that both beat the old best yield one record, not two.
      let e1rmHit: { set: EnrichedSet; value: number } | null = null;
      let loadHit: { set: EnrichedSet; value: number } | null = null;
      let repsHit: { set: EnrichedSet; value: number; prev: number; load: number } | null = null;

      for (const s of session.sets) {
        const est = e1rm(s);
        if (est !== null && best.e1rm !== null && est > best.e1rm) {
          if (e1rmHit === null || est > e1rmHit.value) e1rmHit = { set: s, value: est };
        }
        const load = s.effectiveLoadKg as number;
        if (best.load !== null && load > best.load) {
          if (loadHit === null || load > loadHit.value) loadHit = { set: s, value: load };
        }
        if (s.reps !== null && s.reps > 0) {
          const k = loadKey(load);
          const prev = bestReps.get(k);
          // A load never lifted before is a load record or nothing -- not a rep
          // record too, or a heavier single would count twice.
          if (prev !== undefined && s.reps > prev) {
            const gain = s.reps - prev;
            if (repsHit === null || gain > repsHit.value - repsHit.prev) {
              repsHit = { set: s, value: s.reps, prev, load: k };
            }
          }
        }
      }

      if (e1rmHit) {
        out.push({
          id: exercise + '|e1rm|' + e1rmHit.set.id,
          kind: 'e1rm',
          exercise,
          workoutId: session.workoutId,
          setId: e1rmHit.set.id,
          date: session.date,
          value: e1rmHit.value,
          previous: best.e1rm as number,
          parts: loadParts(e1rmHit.set),
          bodyweightDriven: isBodyweightRelative(e1rmHit.set),
        });
      }
      if (loadHit) {
        out.push({
          id: exercise + '|load|' + loadHit.set.id,
          kind: 'load',
          exercise,
          workoutId: session.workoutId,
          setId: loadHit.set.id,
          date: session.date,
          value: loadHit.value,
          previous: best.load as number,
          parts: loadParts(loadHit.set),
          bodyweightDriven: isBodyweightRelative(loadHit.set),
        });
      }
      if (repsHit) {
        out.push({
          id: exercise + '|reps-at-load|' + repsHit.set.id,
          kind: 'reps-at-load',
          exercise,
          workoutId: session.workoutId,
          setId: repsHit.set.id,
          date: session.date,
          value: repsHit.value,
          previous: repsHit.prev,
          loadKg: repsHit.load,
          parts: loadParts(repsHit.set),
          bodyweightDriven: false,
        });
      }

      absorb(session);
    }
  }

  return out.sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));
}

export function recordsFor(events: RecordEvent[], exercise: string): RecordEvent[] {
  return events.filter((e) => e.exercise === exercise);
}

export type RecordBucket = {
  key: string;
  start: Date;
  count: number;
  byKind: Record<RecordKind, number>;
};

/**
 * Records per period, INCLUDING empty periods -- a month with no PR is the
 * observation the chart exists to show.
 *
 * `span` widens the range beyond first-to-last record. Pass the corpus's own
 * range: without it a lifter whose last PR was in March gets a chart that
 * ends in March, and the dry months since are exactly what was asked about.
 */
export function recordsPerBucket(
  events: RecordEvent[],
  opts: { granularity: Granularity; weekStartsOn?: WeekStart; span?: { from: Date; to: Date } },
): RecordBucket[] {
  const ws = opts.weekStartsOn ?? 1;
  let min: Date | null = opts.span?.from ?? null;
  let max: Date | null = opts.span?.to ?? null;
  for (const e of events) {
    if (min === null || e.date < min) min = e.date;
    if (max === null || e.date > max) max = e.date;
  }
  if (min === null || max === null) return [];

  const byKey = new Map<string, RecordEvent[]>();
  for (const e of events) {
    const k = bucketKey(e.date, opts.granularity, ws);
    const list = byKey.get(k);
    if (list) list.push(e);
    else byKey.set(k, [e]);
  }

  return bucketRange(min, max, opts.granularity, ws).map((start) => {
    const key = bucketKey(start, opts.granularity, ws);
    const items = byKey.get(key) ?? [];
    const byKind: Record<RecordKind, number> = { e1rm: 0, load: 0, 'reps-at-load': 0 };
    for (const e of items) byKind[e.kind]++;
    return { key, start, count: items.length, byKind };
  });
}
