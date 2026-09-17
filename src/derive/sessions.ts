import type { EnrichedSet } from '../model/effectiveLoad';
import type { Workout } from '../model/types';
import { byWorkout, volume, type VolumeResult } from './index';
import type { MetaLookup } from './balance';
import { sessionFocus, type SessionFocus } from './focus';

/**
 * One workout at a time. Pure, like the rest of derive/.
 *
 * `workoutSeries` in series.ts already produces a point per session for the
 * calendar, but a point is not a row: the list needs Strong's label and the
 * exercise names, and the detail view needs the sets themselves in the order
 * they were performed. Both are here rather than bolted onto the series type,
 * which stays a chart input.
 */

export type SessionSummary = {
  workoutId: string;
  date: Date;
  /** Strong's auto-generated time-of-day label, e.g. "Abend-Workout". NOT a routine name. */
  name: string;
  durationSec: number;
  setCount: number;
  workingSets: number;
  exerciseCount: number;
  volume: VolumeResult;
  /** Canonical names, in order of first appearance. */
  exercises: string[];
  /** What the session trained, from its own working sets -- see derive/focus.ts. */
  focus: SessionFocus;
};

export type SessionExercise = {
  name: string;
  /** In `setOrder`, warm-ups and drop sets included. */
  sets: EnrichedSet[];
  volume: VolumeResult;
};

export type SessionDetail = SessionSummary & {
  blocks: SessionExercise[];
};

/** Order of first appearance -- the order the session was actually done in. */
function exerciseOrder(sets: EnrichedSet[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of sets) {
    if (seen.has(s.canonicalName)) continue;
    seen.add(s.canonicalName);
    out.push(s.canonicalName);
  }
  return out;
}

function summarise(
  workoutId: string,
  list: EnrichedSet[],
  workout: Workout | undefined,
  meta: MetaLookup,
): SessionSummary {
  // The parser emits sets in file order, which is performance order; sorting on
  // setOrder alone would interleave two exercises' set 1s. Stable sort keeps
  // file order and only tidies within an exercise.
  let date = list[0]?.date ?? new Date(NaN);
  let working = 0;
  for (const s of list) {
    if (s.date < date) date = s.date;
    if (s.setKind === 'working') working++;
  }
  const exercises = exerciseOrder(list);
  return {
    workoutId,
    date: workout?.date ?? date,
    name: workout?.name ?? '',
    durationSec: workout?.durationSec ?? 0,
    setCount: list.length,
    workingSets: working,
    exerciseCount: exercises.length,
    volume: volume(list),
    exercises,
    focus: sessionFocus(list, meta),
  };
}

/** Every session in the corpus, newest first. */
export function sessionSummaries(
  sets: EnrichedSet[],
  workouts: Workout[],
  meta: MetaLookup,
): SessionSummary[] {
  const byId = new Map(workouts.map((w) => [w.id, w]));
  const out: SessionSummary[] = [];
  for (const [id, list] of byWorkout(sets)) out.push(summarise(id, list, byId.get(id), meta));
  return out.sort((a, b) => b.date.getTime() - a.date.getTime());
}

/**
 * One session, or null when the id is not in the corpus -- a stale link after
 * a re-import, say. Ids are content hashes of date plus name, so the same
 * session survives a re-export unchanged and only a genuinely different file
 * makes a link go dead.
 */
export function sessionDetail(
  sets: EnrichedSet[],
  workouts: Workout[],
  workoutId: string,
  meta: MetaLookup,
): SessionDetail | null {
  const list = sets.filter((s) => s.workoutId === workoutId);
  if (list.length === 0) return null;
  const summary = summarise(workoutId, list, workouts.find((w) => w.id === workoutId), meta);

  const groups = new Map<string, EnrichedSet[]>();
  for (const s of list) {
    const g = groups.get(s.canonicalName);
    if (g) g.push(s);
    else groups.set(s.canonicalName, [s]);
  }
  const blocks: SessionExercise[] = summary.exercises.map((name) => {
    const own = (groups.get(name) ?? []).slice().sort((a, b) => a.setOrder - b.setOrder);
    return { name, sets: own, volume: volume(own) };
  });

  return { ...summary, blocks };
}
