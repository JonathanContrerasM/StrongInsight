import { useMemo } from 'react';
import { useWorkoutData } from './useWorkoutData';
import type { EnrichedSet } from '../model/effectiveLoad';
import { calendarDays, type DayCell } from '../derive/series';
import { balanceSeries, balanceVerdict, volumeMatrix, type GroupBy } from '../derive/balance';
import { habitMap, repDensity, muscleGroup } from '../derive/profile';
import { cooccurrence, type CooccurrenceResult } from '../derive/cooccurrence';
import { findings, type FindingSet } from '../derive/insights';
import type { ExerciseMeta } from '../model/types';
import type { Granularity } from '../derive/buckets';

/**
 * Corpus-wide derivations shared by several charts (tier B).
 *
 * Sits strictly below the existing M1-M5 graph in useWorkoutData and adds no
 * dependency to it, so importing a CSV still parses exactly once and a metadata
 * edit never re-parses.
 */

export type AnalyticsOptions = {
  granularity: Granularity;
  groupBy: GroupBy;
};

export function useAnalytics({ granularity, groupBy }: AnalyticsOptions) {
  const data = useWorkoutData();
  const { sets, workouts, meta, settings } = data;

  const durations = useMemo(() => {
    const m = new Map<string, number>();
    for (const w of workouts) m.set(w.id, w.durationSec);
    return m;
  }, [workouts]);

  const days: DayCell[] = useMemo(() => calendarDays(sets, durations), [sets, durations]);

  /**
   * Metadata lookup that folds fine-grained muscles into groups when the caller
   * asked for muscle grouping. 20 muscles exceed what categorical colour can
   * carry; the muscle heatmap uses a sequential scale and so keeps full detail.
   */
  const lookup = useMemo(() => (name: string) => meta[name], [meta]);

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

  /** Which recovered group a given day's session belongs to, if any dominates. */
  const clusterOfDay = useMemo(() => {
    const memberToCluster = new Map<string, number>();
    split.clusters.forEach((c, i) => c.members.forEach((m) => memberToCluster.set(m, i)));

    return (day: DayCell): number | null => {
      if (!day.hasWorkout) return null;
      const counts = new Map<number, number>();
      let placed = 0;
      for (const name of day.exercises) {
        const c = memberToCluster.get(name);
        if (c === undefined) continue;
        counts.set(c, (counts.get(c) ?? 0) + 1);
        placed++;
      }
      if (placed === 0) return null;
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
      // Never force an assignment: a genuinely mixed session stays mixed.
      return top && top[1] / placed >= 0.5 ? top[0] : null;
    };
  }, [split]);

  const unconfirmedSets = useMemo(() => sets.filter((s) => !s.metaConfirmed).length, [sets]);

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
    clusterOfDay,
    clusterLabels: split.clusters.map((c) => c.label),
    unconfirmedSets,
    insights,
    lookup,
  };
}
