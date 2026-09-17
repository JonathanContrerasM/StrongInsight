import type { EnrichedSet } from '../model/effectiveLoad';
import { bucketBy, daysBetween, type WeekStart } from './buckets';

/**
 * Consecutive weeks of real training. Pure, and with no "now".
 *
 * A "trained week" has at least STREAK_MIN_SESSIONS sessions. Two is the bar
 * because one session a week is maintenance for almost nobody, and because a
 * streak that a single visit keeps alive measures attendance, not training.
 * It is a constant rather than a setting, for now.
 *
 * The trailing week is the subtle case. A corpus exported on a Tuesday ends in
 * a week that has had one day to accumulate sessions, and reading that as a
 * broken streak would be wrong in exactly the situation people look. So the
 * current streak is measured to the last COMPLETE week, and a trailing partial
 * week extends it only if it already qualifies on its own.
 */

export const STREAK_MIN_SESSIONS = 2;

export type Streaks = {
  /** Trained weeks in a row, ending at the last complete week (or the partial one if it qualifies). */
  current: number;
  currentFrom: Date | null;
  longest: number;
  longestFrom: Date | null;
  minSessions: number;
  /** Weeks in the span, empty ones included. */
  weeks: number;
  /** True when the corpus ends mid-week and that week did not (yet) qualify. */
  trailingPartial: boolean;
};

const EMPTY: Streaks = {
  current: 0,
  currentFrom: null,
  longest: 0,
  longestFrom: null,
  minSessions: STREAK_MIN_SESSIONS,
  weeks: 0,
  trailingPartial: false,
};

export function streaks(
  sets: EnrichedSet[],
  weekStartsOn: WeekStart,
  minSessions = STREAK_MIN_SESSIONS,
): Streaks {
  const weeks = bucketBy(sets, (s) => s.date, 'week', weekStartsOn);
  if (weeks.length === 0) return { ...EMPTY, minSessions };

  const counts = weeks.map((w) => new Set(w.items.map((s) => s.workoutId)).size);
  const trained = counts.map((c) => c >= minSessions);

  let last: Date | null = null;
  for (const s of sets) if (last === null || s.date > last) last = s.date;
  // The last bucket is partial if the corpus ends before its seventh day.
  const lastWeek = weeks[weeks.length - 1]!;
  const partial = last !== null && daysBetween(lastWeek.start, last) < 6;
  const trailingPartial = partial && !trained[trained.length - 1];

  // Longest: a plain scan.
  let longest = 0;
  let longestFrom: Date | null = null;
  let run = 0;
  for (let i = 0; i < trained.length; i++) {
    run = trained[i] ? run + 1 : 0;
    if (run > longest) {
      longest = run;
      longestFrom = weeks[i - run + 1]?.start ?? null;
    }
  }

  // Current: walk back from the last week that counts.
  let end = trained.length - 1;
  if (trailingPartial) end--;
  let current = 0;
  let currentFrom: Date | null = null;
  for (let i = end; i >= 0 && trained[i]; i--) {
    current++;
    currentFrom = weeks[i]?.start ?? null;
  }

  return {
    current,
    currentFrom,
    longest,
    longestFrom,
    minSessions,
    weeks: weeks.length,
    trailingPartial,
  };
}
