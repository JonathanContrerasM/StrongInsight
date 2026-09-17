import type { EnrichedSet } from '../model/effectiveLoad';
import type { MetaLookup } from './balance';
import { bucketBy, daysBetween, startOfDay, type WeekStart } from './buckets';
import { FOCUS_GROUPS, focusGroupOf, type FocusGroup } from './focus';
import { median } from './stats';

/**
 * How often each movement group gets trained, and how long since it last was.
 *
 * Frequency, not focus: a session "trains" a group when ANY working set lands
 * there. The 20% threshold in focus.ts decides what a session was about; one
 * set of curls on a leg day is still pull work getting done, and for recovery
 * it is the fact that it happened that matters.
 *
 * Pure, and -- like the insights engine -- with no "now". Days since a group
 * was last trained are counted to the corpus's last session, never to the
 * wall clock, so an export from three months ago does not report every group
 * as neglected for ninety days.
 */

export type GroupFrequency = {
  group: FocusGroup;
  /** Sessions with at least one working set in the group, per calendar week of the span. */
  sessionsPerWeek: number;
  /** Such sessions, in absolute terms. */
  sessions: number;
  /** Working sets in the group across the span. */
  sets: number;
  /** Days between the last session that trained it and the corpus's last session. Null if never. */
  daysSince: number | null;
  /** Median gap between consecutive sessions that trained it. Null below two sessions. */
  medianGapDays: number | null;
};

export function muscleFrequency(
  sets: EnrichedSet[],
  meta: MetaLookup,
  weekStartsOn: WeekStart,
): GroupFrequency[] {
  const working = sets.filter((s) => s.setKind !== 'warmup');
  const weeks = bucketBy(working, (s) => s.date, 'week', weekStartsOn).length;

  // Per group: the distinct session days it was trained on, and the set count.
  const days = new Map<FocusGroup, Map<number, Date>>();
  const counts = new Map<FocusGroup, number>();
  for (const g of FOCUS_GROUPS) {
    days.set(g, new Map());
    counts.set(g, 0);
  }
  let last: Date | null = null;
  for (const s of working) {
    if (last === null || s.date > last) last = s.date;
    const g = focusGroupOf(meta(s.canonicalName));
    if (g === null) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
    const d = startOfDay(s.date);
    days.get(g)?.set(d.getTime(), d);
  }

  return FOCUS_GROUPS.map((group) => {
    const trained = [...(days.get(group)?.values() ?? [])].sort(
      (a, b) => a.getTime() - b.getTime(),
    );
    const gaps: number[] = [];
    for (let i = 1; i < trained.length; i++) {
      gaps.push(daysBetween(trained[i - 1] as Date, trained[i] as Date));
    }
    const lastTrained = trained[trained.length - 1] ?? null;
    return {
      group,
      sessionsPerWeek: weeks === 0 ? 0 : trained.length / weeks,
      sessions: trained.length,
      sets: counts.get(group) ?? 0,
      daysSince: lastTrained && last ? daysBetween(lastTrained, last) : null,
      medianGapDays: gaps.length === 0 ? null : median(gaps),
    };
  });
}
