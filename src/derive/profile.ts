import type { EnrichedSet } from '../model/effectiveLoad';
import { mean } from './stats';

/**
 * Within-exercise and distribution profiles.
 */

export type SetPositionPoint = {
  setOrder: number;
  meanReps: number | null;
  meanLoadKg: number | null;
  /** Load as a fraction of the heaviest position, so shapes compare across lifts. */
  relativeLoad: number | null;
  relativeReps: number | null;
  setCount: number;
};

export type SetPositionProfile = {
  points: SetPositionPoint[];
  /**
   * What the shape actually is. Naming this matters: a "fatigue curve" is the
   * obvious chart to build, but in real data load frequently RISES across set
   * positions because the athlete ramps up within their numbered sets. In the
   * reference corpus Squat runs 14 -> 36 -> 60 -> 73 -> 81 kg, while Push Up,
   * where load is pinned at bodyweight, decays 13.0 -> 11.5 -> 9.3 reps.
   *
   * Reporting the shape stops the chart from implying fatigue where there is a
   * warm-up ramp.
   */
  shape: 'ramping' | 'straight' | 'fatiguing' | 'insufficient-data';
};

/**
 * Mean reps AND mean load by set position. Both are required: reps alone reads
 * as fatigue when load is constant, and as nothing when load is ramping.
 */
export function setPositionProfile(sets: EnrichedSet[], maxPositions = 10): SetPositionProfile {
  const byPos = new Map<number, EnrichedSet[]>();
  for (const s of sets) {
    if (s.setOrder < 1 || s.setOrder > maxPositions) continue;
    const list = byPos.get(s.setOrder);
    if (list) list.push(s);
    else byPos.set(s.setOrder, [s]);
  }

  const positions = [...byPos.keys()].sort((a, b) => a - b);
  const points: SetPositionPoint[] = positions.map((setOrder) => {
    const items = byPos.get(setOrder) ?? [];
    const reps = items.map((s) => s.reps).filter((r): r is number => r !== null && r > 0);
    const loads = items
      .filter((s) => !s.isUnloaded && s.effectiveLoadKg !== null && s.effectiveLoadKg > 0)
      .map((s) => s.effectiveLoadKg as number);
    return {
      setOrder,
      meanReps: mean(reps),
      meanLoadKg: mean(loads),
      relativeLoad: null,
      relativeReps: null,
      setCount: items.length,
    };
  });

  const maxLoad = points.reduce((m, p) => (p.meanLoadKg !== null && p.meanLoadKg > m ? p.meanLoadKg : m), 0);
  const maxReps = points.reduce((m, p) => (p.meanReps !== null && p.meanReps > m ? p.meanReps : m), 0);
  for (const p of points) {
    p.relativeLoad = maxLoad > 0 && p.meanLoadKg !== null ? p.meanLoadKg / maxLoad : null;
    p.relativeReps = maxReps > 0 && p.meanReps !== null ? p.meanReps / maxReps : null;
  }

  return { points, shape: classifyShape(points) };
}

function classifyShape(points: SetPositionPoint[]): SetPositionProfile['shape'] {
  // Need at least three positions with enough sets to say anything.
  const usable = points.filter((p) => p.setCount >= 2);
  if (usable.length < 3) return 'insufficient-data';

  const first = usable[0];
  const last = usable[usable.length - 1];
  if (!first || !last) return 'insufficient-data';

  const loadFirst = first.meanLoadKg;
  const loadLast = last.meanLoadKg;
  if (loadFirst !== null && loadLast !== null && loadFirst > 0) {
    const change = (loadLast - loadFirst) / loadFirst;
    // A clear upward load trend is a warm-up ramp, not fatigue.
    if (change > 0.15) return 'ramping';
  }

  const repsFirst = first.meanReps;
  const repsLast = last.meanReps;
  if (repsFirst !== null && repsLast !== null && repsFirst > 0) {
    const change = (repsLast - repsFirst) / repsFirst;
    // Reps falling while load is flat is genuine fatigue.
    if (change < -0.12) return 'fatiguing';
  }

  return 'straight';
}

// --- distributions ------------------------------------------------------------

export type RepBin = { reps: number; setCount: number };

/** Rep histogram across working sets. Reveals the training zones actually used. */
export function repDensity(sets: EnrichedSet[], maxReps = 30): RepBin[] {
  const counts = new Map<number, number>();
  for (const s of sets) {
    if (s.setKind !== 'working') continue;
    const r = s.reps;
    if (r === null || r <= 0) continue;
    const k = Math.min(Math.round(r), maxReps);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reps, setCount]) => ({ reps, setCount }))
    .sort((a, b) => a.reps - b.reps);
}

export type DensityCell = { repBin: number; loadBin: number; setCount: number };

export type LoadRepDensity = {
  cells: DensityCell[];
  repValues: number[];
  loadEdges: number[];
  maxCount: number;
};

/**
 * Weight x reps density for one exercise: where this movement's sets actually
 * land. Load is binned; reps are kept as integers because lifters work in whole
 * reps and binning them would blur the very structure worth seeing.
 */
export function loadRepDensity(sets: EnrichedSet[], loadBinCount = 10): LoadRepDensity {
  const usable = sets.filter(
    (s) =>
      !s.isUnloaded &&
      s.effectiveLoadKg !== null &&
      s.effectiveLoadKg > 0 &&
      s.reps !== null &&
      s.reps > 0,
  );
  if (usable.length === 0) return { cells: [], repValues: [], loadEdges: [], maxCount: 0 };

  const loads = usable.map((s) => s.effectiveLoadKg as number);
  const minLoad = Math.min(...loads);
  const maxLoad = Math.max(...loads);
  const span = maxLoad - minLoad;
  const binCount = span === 0 ? 1 : loadBinCount;
  const step = span === 0 ? 1 : span / binCount;

  const loadEdges: number[] = [];
  for (let i = 0; i <= binCount; i++) loadEdges.push(minLoad + step * i);

  const counts = new Map<string, DensityCell>();
  const repSet = new Set<number>();

  for (const s of usable) {
    const reps = Math.round(s.reps as number);
    const load = s.effectiveLoadKg as number;
    const loadBin = span === 0 ? 0 : Math.min(binCount - 1, Math.floor((load - minLoad) / step));
    repSet.add(reps);
    const key = reps + '|' + loadBin;
    const cell = counts.get(key);
    if (cell) cell.setCount++;
    else counts.set(key, { repBin: reps, loadBin, setCount: 1 });
  }

  const cells = [...counts.values()];
  return {
    cells,
    repValues: [...repSet].sort((a, b) => a - b),
    loadEdges,
    maxCount: cells.reduce((m, c) => (c.setCount > m ? c.setCount : m), 0),
  };
}

// --- training habits ----------------------------------------------------------

export type HabitCell = { weekday: number; hour: number; workoutCount: number };

export type HabitMap = {
  cells: HabitCell[];
  maxCount: number;
  totalWorkouts: number;
  /**
   * False when every session starts at exactly midnight, which means the export
   * carries no time-of-day information at all. Strong's date column has an
   * optional time component; without this guard the chart draws a dramatic
   * midnight spike that is purely an artefact of missing data.
   */
  hasTimeOfDay: boolean;
  /** Observed hour range, so the grid can crop instead of drawing 18 empty columns. */
  hourMin: number;
  hourMax: number;
  /** Marginals -- these carry the headline better than the grid alone. */
  weekdayTotals: number[];
};

/**
 * Day-of-week x hour-of-day session counts, keyed on when each WORKOUT started
 * rather than per set, so a long session is one observation.
 */
export function habitMap(sets: EnrichedSet[]): HabitMap {
  const firstByWorkout = new Map<string, Date>();
  for (const s of sets) {
    const prev = firstByWorkout.get(s.workoutId);
    if (!prev || s.date < prev) firstByWorkout.set(s.workoutId, s.date);
  }

  const counts = new Map<string, HabitCell>();
  for (const d of firstByWorkout.values()) {
    const weekday = d.getDay();
    const hour = d.getHours();
    const key = weekday + '|' + hour;
    const cell = counts.get(key);
    if (cell) cell.workoutCount++;
    else counts.set(key, { weekday, hour, workoutCount: 1 });
  }

  const cells = [...counts.values()];
  const weekdayTotals = new Array<number>(7).fill(0);
  for (const c of cells) weekdayTotals[c.weekday] = (weekdayTotals[c.weekday] ?? 0) + c.workoutCount;

  const hours = cells.map((c) => c.hour);
  const hasTimeOfDay = hours.some((h) => h !== 0);

  return {
    cells,
    maxCount: cells.reduce((m, c) => (c.workoutCount > m ? c.workoutCount : m), 0),
    totalWorkouts: firstByWorkout.size,
    hasTimeOfDay,
    hourMin: hours.length ? Math.min(...hours) : 0,
    hourMax: hours.length ? Math.max(...hours) : 0,
    weekdayTotals,
  };
}

// --- muscle grouping ----------------------------------------------------------

export type MuscleGroup = 'push' | 'pull' | 'legs' | 'core' | 'other';

/**
 * Fold ~20 muscles into 5 groups.
 *
 * Categorical colour encoding stops being readable past about 8 classes, and a
 * 20-series stacked chart is unreadable regardless of palette. The fine-grained
 * muscle stays available for the heatmap, which uses a sequential scale and so
 * is not bound by that limit.
 */
export function muscleGroup(muscle: string): MuscleGroup | 'unknown' {
  switch (muscle) {
    case 'chest':
    case 'shoulders':
    case 'triceps':
      return 'push';
    case 'back':
    case 'lats':
    case 'traps':
    case 'biceps':
    case 'forearms':
      return 'pull';
    case 'quads':
    case 'hamstrings':
    case 'glutes':
    case 'calves':
    case 'adductors':
    case 'abductors':
      return 'legs';
    case 'abs':
    case 'obliques':
    case 'lower-back':
      return 'core';
    case 'neck':
    case 'full-body':
      return 'other';
    default:
      return 'unknown';
  }
}
