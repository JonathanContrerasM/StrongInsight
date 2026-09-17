import { useMemo } from 'react';
import { useWorkoutData } from './useWorkoutData';
import type { EnrichedSet } from '../model/effectiveLoad';
import { calendarDays, type DayCell } from '../derive/series';
import { balanceSeries, balanceVerdict, volumeMatrix, type GroupBy } from '../derive/balance';
import { habitMap, repDensity, muscleGroup } from '../derive/profile';
import { cooccurrence, type CooccurrenceResult } from '../derive/cooccurrence';
import { findings, type FindingSet } from '../derive/insights';
import { records, recordsPerBucket, type RecordEvent } from '../derive/records';
import { muscleFrequency } from '../derive/frequency';
import { streaks } from '../derive/streaks';
import type { ExerciseMeta } from '../model/types';
import type { Granularity } from '../derive/buckets';

/**
 * Corpus-wide derivations shared by several charts (tier B).
 *
 * Sits strictly below the existing M1-M5 graph in useWorkoutData and adds no
 * dependency to it, so importing a CSV still parses exactly once and a metadata
 * edit never re-parses. Reads the SCOPED sets, so every chart and the insights
 * engine follow the date range together.
 */

export type AnalyticsOptions = {
  granularity: Granularity;
  groupBy: GroupBy;
};

export function useAnalytics({ granularity, groupBy }: AnalyticsOptions) {
  const data = useWorkoutData();
  const { scopedSets: sets, scopedWorkouts: workouts, meta, settings } = data;

  const durations = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workouts) m.set(w.id, w.durationSec);
    return m;
  }, [workouts]);

  /**
   * Metadata lookup that folds fine-grained muscles into groups when the caller
   * asked for muscle grouping. 20 muscles exceed what categorical colour can
   * carry; the muscle heatmap uses a sequential scale and so keeps full detail.
   */
  const lookup = useMemo(() => (name: string) => meta[name], [meta]);

  const days: DayCell[] = useMemo(
    () => calendarDays(sets, durations, lookup),
    [sets, durations, lookup],
  );

  const groupedLookup = useMemo(() => {
    return (name: string): ExerciseMeta | undefined => {
      const m = meta[name];
      if (!m) return undefined;
      if (groupBy !== 'muscle') return m;
      return { ...m, primaryMuscle: muscleGroup(m.primaryMuscle) as ExerciseMeta['primaryMuscle'] };
    };
  }, [meta, groupBy]);

  const matrix = useMemo(
    () =>
      volumeMatrix(sets, groupedLookup, {
        granularity,
        weekStartsOn: settings.weekStartsOn,
        by: groupBy,
      }),
    [sets, groupedLookup, granularity, groupBy, settings.weekStartsOn],
  );

  const detailedMuscleMatrix = useMemo(
    () =>
      volumeMatrix(sets, lookup, {
        granularity,
        weekStartsOn: settings.weekStartsOn,
        by: 'muscle',
      }),
    [sets, lookup, granularity, settings.weekStartsOn],
  );

  const balance = useMemo(
    () => balanceSeries(sets, lookup, { granularity, weekStartsOn: settings.weekStartsOn }),
    [sets, lookup, granularity, settings.weekStartsOn],
  );

  const verdict = useMemo(() => balanceVerdict(balance), [balance]);

  const habit = useMemo(() => habitMap(sets), [sets]);
  const reps = useMemo(() => repDensity(sets), [sets]);

  /**
   * Clustering is expensive, but it depends only on which exercises share a
   * session -- and canonical names change only when an ALIAS changes, never when
   * a muscle tag is edited. Keying on this cheap signature stops every keystroke
   * in the tagging tray from re-running the clustering.
   */
  const sessionKey = useMemo(() => {
    const byWorkout = new Map<string, Set<string>>();
    for (const s of sets) {
      const g = byWorkout.get(s.workoutId);
      if (g) g.add(s.canonicalName);
      else byWorkout.set(s.workoutId, new Set([s.canonicalName]));
    }
    return [...byWorkout.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([id, names]) => id + ':' + [...names].sort().join(','))
      .join('|');
  }, [sets]);

  const split: CooccurrenceResult = useMemo(
    () => cooccurrence(sets, lookup),
    // Intentionally keyed on the session signature, not on `sets` or `meta`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessionKey],
  );

  const unconfirmedSets = useMemo(() => sets.filter((s) => !s.metaConfirmed).length, [sets]);

  const frequency = useMemo(
    () => muscleFrequency(sets, lookup, settings.weekStartsOn),
    [sets, lookup, settings.weekStartsOn],
  );

  const streak = useMemo(() => streaks(sets, settings.weekStartsOn), [sets, settings.weekStartsOn]);

  /** Every personal record, ascending. Depends on load, hence on metadata. */
  const events: RecordEvent[] = useMemo(() => records(sets), [sets]);

  /** Monthly, spanned to the corpus so the dry months at the end are drawn. */
  const recordsMonthly = useMemo(() => {
    let first: Date | null = null;
    let last: Date | null = null;
    for (const s of sets) {
      if (first === null || s.date < first) first = s.date;
      if (last === null || s.date > last) last = s.date;
    }
    return recordsPerBucket(events, {
      granularity: 'month',
      weekStartsOn: settings.weekStartsOn,
      span: first && last ? { from: first, to: last } : undefined,
    });
  }, [events, sets, settings.weekStartsOn]);

  /**
   * The weakness engine. Kept out of the `split` memo above deliberately: that
   * one is keyed on a session signature so tagging does not re-cluster, whereas
   * these rules genuinely do depend on metadata -- retagging an exercise changes
   * which muscle it counts toward.
   */
  const insights: FindingSet = useMemo(
    () => findings(sets, lookup, { weekStartsOn: settings.weekStartsOn }),
    [sets, lookup, settings.weekStartsOn],
  );

  return {
    sets: sets as EnrichedSet[],
    days,
    matrix,
    detailedMuscleMatrix,
    balance,
    verdict,
    habit,
    reps,
    split,
    unconfirmedSets,
    insights,
    records: events,
    recordsMonthly,
    frequency,
    streak,
    lookup,
  };
}
