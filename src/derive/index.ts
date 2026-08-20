import type { EnrichedSet } from '../model/effectiveLoad';

/**
 * PURE functions over EnrichedSet[]. No React, no IO, no dates-from-now.
 * Every future chart and insight rule will be written against this module, so it
 * must stay trivially unit-testable.
 */

// --- estimated 1RM -----------------------------------------------------------

export type E1rmFormula = 'epley' | 'brzycki';

/**
 * Both formulas become fiction past about 12 reps, so we refuse rather than
 * emit a confident-looking wrong number.
 * FUTURE: rep cap and formula choice should become user settings.
 */
export const E1RM_REP_CAP = 12;

export function epley(weightKg: number, reps: number): number {
  // The raw formula returns 1.033x at 1 rep; a single is by definition the 1RM.
  if (reps <= 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export function brzycki(weightKg: number, reps: number): number {
  if (reps <= 1) return weightKg;
  const denom = 37 - reps;
  if (denom <= 0) return NaN;
  return weightKg * (36 / denom);
}

/**
 * Estimated 1RM for one set, or null when it is not meaningful:
 * unquantifiable load, an unloaded (empty-bar) set, no reps, or beyond the cap.
 */
export function e1rm(set: EnrichedSet, formula: E1rmFormula = 'epley'): number | null {
  if (set.isUnloaded) return null;
  const load = set.effectiveLoadKg;
  const reps = set.reps;
  if (load === null || load <= 0) return null;
  if (reps === null || reps <= 0) return null;
  if (reps > E1RM_REP_CAP) return null;
  const value = formula === 'brzycki' ? brzycki(load, reps) : epley(load, reps);
  return Number.isFinite(value) ? value : null;
}

// --- volume ------------------------------------------------------------------

export type VolumeResult = {
  volumeKg: number;
  includedSets: number;
  /** Sets that carried no quantifiable load, broken down so a dip is explainable. */
  excludedSets: number;
  excludedUnloaded: number;
  excludedNoLoad: number;
  excludedNoReps: number;
};

/**
 * Sum of effectiveLoad x reps.
 * Returns the exclusion breakdown alongside the number so a future chart can
 * explain a dip instead of silently plotting zero.
 */
export function volume(sets: EnrichedSet[]): VolumeResult {
  let volumeKg = 0;
  let includedSets = 0;
  let excludedUnloaded = 0;
  let excludedNoLoad = 0;
  let excludedNoReps = 0;

  for (const s of sets) {
    if (s.isUnloaded) {
      excludedUnloaded++;
      continue;
    }
    if (s.effectiveLoadKg === null || s.effectiveLoadKg <= 0) {
      excludedNoLoad++;
      continue;
    }
    if (s.reps === null || s.reps <= 0) {
      excludedNoReps++;
      continue;
    }
    volumeKg += s.effectiveLoadKg * s.reps;
    includedSets++;
  }

  return {
    volumeKg,
    includedSets,
    excludedSets: excludedUnloaded + excludedNoLoad + excludedNoReps,
    excludedUnloaded,
    excludedNoLoad,
    excludedNoReps,
  };
}

// --- set counts --------------------------------------------------------------

export type SetCounts = {
  total: number;
  working: number;
  warmup: number;
  dropset: number;
  unloaded: number;
};

export function setCounts(sets: EnrichedSet[]): SetCounts {
  const c: SetCounts = { total: 0, working: 0, warmup: 0, dropset: 0, unloaded: 0 };
  for (const s of sets) {
    c.total++;
    if (s.setKind === 'working') c.working++;
    else if (s.setKind === 'warmup') c.warmup++;
    else c.dropset++;
    if (s.isUnloaded) c.unloaded++;
  }
  return c;
}

// --- grouping helpers --------------------------------------------------------

/** Group by canonical name, so aliased renames merge into one history. */
export function byExercise(sets: EnrichedSet[]): Map<string, EnrichedSet[]> {
  const out = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const list = out.get(s.canonicalName);
    if (list) list.push(s);
    else out.set(s.canonicalName, [s]);
  }
  return out;
}

export function byWorkout(sets: EnrichedSet[]): Map<string, EnrichedSet[]> {
  const out = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const list = out.get(s.workoutId);
    if (list) list.push(s);
    else out.set(s.workoutId, [s]);
  }
  return out;
}

export type ExerciseSummary = {
  name: string;
  counts: SetCounts;
  volume: VolumeResult;
  firstDate: Date | null;
  lastDate: Date | null;
  bestE1rmKg: number | null;
  heaviestKg: number | null;
};

export function summarise(name: string, sets: EnrichedSet[]): ExerciseSummary {
  let firstDate: Date | null = null;
  let lastDate: Date | null = null;
  let bestE1rmKg: number | null = null;
  let heaviestKg: number | null = null;

  for (const s of sets) {
    if (firstDate === null || s.date < firstDate) firstDate = s.date;
    if (lastDate === null || s.date > lastDate) lastDate = s.date;
    const est = e1rm(s);
    if (est !== null && (bestE1rmKg === null || est > bestE1rmKg)) bestE1rmKg = est;
    const load = s.isUnloaded ? null : s.effectiveLoadKg;
    if (load !== null && (heaviestKg === null || load > heaviestKg)) heaviestKg = load;
  }

  return {
    name,
    counts: setCounts(sets),
    volume: volume(sets),
    firstDate,
    lastDate,
    bestE1rmKg,
    heaviestKg,
  };
}

export function summariseAll(sets: EnrichedSet[]): ExerciseSummary[] {
  return [...byExercise(sets)]
    .map(([name, list]) => summarise(name, list))
    .sort((a, b) => b.counts.total - a.counts.total);
}

// --- iteration 2: chart metrics ----------------------------------------------
// Re-exported so views import from one place. All of these are pure.
export * from './stats';
export * from './buckets';
export * from './series';
export * from './balance';
export * from './profile';
export * from './cooccurrence';
