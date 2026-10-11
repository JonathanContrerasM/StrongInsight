import type { EnrichedSet } from '../model/effectiveLoad';
import { MUSCLES, type Muscle } from '../model/types';
import type { MetaLookup } from './balance';
import { startOfDay } from './buckets';
import { e1rm } from './index';

/**
 * How fatigued each muscle is at a given moment: a heuristic, not a measurement.
 *
 * The model, per muscle:
 *   1. Every session deposits a stimulus counted in HARD SETS, not tonnage --
 *      the unit the hypertrophy literature counts stimulus in. A set adds
 *      `muscleWeight x effortWeight`: 1 for the primary muscle and 0.5 for each
 *      secondary; full effort at 3 reps in reserve or closer, tapering to 0.3 at
 *      6+ RIR. Warm-ups count 0.3. A session is capped at 12 sets per muscle;
 *      junk volume past that does not keep adding fatigue.
 *   2. The session's sets are divided by 8 and scaled by how unusual its week
 *      was: the muscle's sets on that calendar day and the six before it,
 *      against its weekly average over the four weeks before that, clamped to
 *      0.5..2. Calendar days, not hours, so a lifter who trains legs every
 *      Friday is not read as doubling up when this Friday's session started an
 *      hour earlier than last Friday's.
 *   3. Stimulus decays exponentially with a per-muscle half-life: 30 h for the
 *      big lower-body muscles and the lower back, 24 h for chest, back and
 *      calves, 18 h for arms, shoulders and trunk.
 *   4. The summed residue x maps to 0..1 as `1 - e^-x`, so fatigue saturates
 *      instead of growing without bound.
 *
 * Reps in reserve come from logged RPE (10 - RPE). Strong exports rarely carry
 * it, so otherwise RIR is estimated by inverting Epley against the exercise's
 * best e1RM of the previous 90 days. With neither, a set counts in full.
 *
 * Steps 1-2 depend only on each session's own past, so they run once
 * (`fatigueStimuli`) and any number of moments can then be read off cheaply --
 * now, a forecast, every day of a history strip.
 *
 * Pure: `asOf` is a parameter and the clock is never read. The view decides
 * whether that is now or the last session.
 */

export const FATIGUE_SETS_PER_UNIT = 8;
export const FATIGUE_MAX_SETS_PER_SESSION = 12;
export const FATIGUE_SECONDARY_WEIGHT = 0.5;
export const FATIGUE_WARMUP_WEIGHT = 0.3;
/** RIR at or under which a set counts in full. */
export const FATIGUE_HARD_RIR = 3;
/** RIR at or over which a set counts the floor weight. */
export const FATIGUE_EASY_RIR = 6;
export const FATIGUE_RIR_FLOOR_WEIGHT = 0.3;
/** Sessions older than this no longer deposit any fatigue worth drawing. */
export const FATIGUE_LOOKBACK_DAYS = 30;
/** "This week": the session's calendar day and the six before it. */
export const FATIGUE_ACUTE_DAYS = 7;
/** The weeks before "this week" that set the baseline. */
export const FATIGUE_BASELINE_WEEKS = 4;
/** Damps the ratio for someone with almost no history. */
export const FATIGUE_NOVICE_WEEKLY_SETS = 4;
export const FATIGUE_GAIN_MIN = 0.5;
export const FATIGUE_GAIN_MAX = 2;
/** Window the e1RM anchor for RIR estimation is taken from. */
export const FATIGUE_E1RM_WINDOW_DAYS = 90;
/** An export whose last session is older than this is treated as stale by the view. */
export const STALE_AFTER_DAYS = 7;
/** Weekly hard sets per muscle, the range commonly cited for hypertrophy. A guide, not a rule. */
export const WEEKLY_SETS_TARGET = { low: 10, high: 20 } as const;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The muscles the model tracks: every tag except the two that name no muscle. */
export const TRACKED_MUSCLES = MUSCLES.filter(
  (m): m is Exclude<Muscle, 'full-body' | 'unknown'> => m !== 'full-body' && m !== 'unknown',
);
export type TrackedMuscle = (typeof TRACKED_MUSCLES)[number];

export const FATIGUE_HALF_LIFE_HOURS: Record<TrackedMuscle, number> = {
  quads: 30,
  hamstrings: 30,
  glutes: 30,
  'lower-back': 30,
  adductors: 30,
  abductors: 30,
  chest: 24,
  back: 24,
  lats: 24,
  traps: 24,
  calves: 24,
  shoulders: 18,
  biceps: 18,
  triceps: 18,
  forearms: 18,
  abs: 18,
  obliques: 18,
  neck: 18,
};

export type FatigueState = 'ready' | 'recovering' | 'fatigued';
export type FatigueLevel = 0 | 1 | 2 | 3 | 4;

/**
 * The ONE threshold table. Colour level and word label are both read from it,
 * so a muscle can never be tinted "recovering" while labelled "ready" -- the
 * mismatch this model was reverse-engineered with.
 */
export const FATIGUE_LEVELS: ReadonlyArray<{ from: number; level: FatigueLevel; state: FatigueState }> = [
  { from: 0, level: 0, state: 'ready' },
  { from: 0.25, level: 1, state: 'recovering' },
  { from: 0.375, level: 2, state: 'recovering' },
  { from: 0.5, level: 3, state: 'fatigued' },
  { from: 0.7, level: 4, state: 'fatigued' },
];

/** Fatigue below this is "ready". */
export const READY_BELOW = 0.25;
/** Fatigue at or above this is "fatigued": what training "while fatigued" means. */
export const FATIGUED_FROM = 0.5;

function band(value: number) {
  let hit = FATIGUE_LEVELS[0]!;
  for (const b of FATIGUE_LEVELS) if (value >= b.from) hit = b;
  return hit;
}

export function fatigueLevelOf(value: number): FatigueLevel {
  return band(value).level;
}

export function fatigueStateOf(value: number): FatigueState {
  return band(value).state;
}

export function halfLifeDecay(ageMs: number, halfLifeMs: number): number {
  return 0.5 ** (ageMs / halfLifeMs);
}

/** 1 at RIR <= 3, linear down to the floor at RIR >= 6, 1 when unknown. */
export function rirWeight(rir: number | null): number {
  if (rir === null) return 1;
  if (rir <= FATIGUE_HARD_RIR) return 1;
  if (rir >= FATIGUE_EASY_RIR) return FATIGUE_RIR_FLOOR_WEIGHT;
  const t = (rir - FATIGUE_HARD_RIR) / (FATIGUE_EASY_RIR - FATIGUE_HARD_RIR);
  return 1 - (1 - FATIGUE_RIR_FLOOR_WEIGHT) * t;
}

/**
 * Reps in reserve estimated from the best recent e1RM, inverting Epley:
 * `1RM = w(1 + r/30)` gives the reps possible at w as `30(1RM/w - 1)`.
 * Null when there is no anchor, no load or no reps.
 */
export function estimateRir(loadKg: number | null, reps: number | null, anchorKg: number | null): number | null {
  if (anchorKg === null || !(anchorKg > 0)) return null;
  if (loadKg === null || !(loadKg > 0)) return null;
  if (reps === null || !(reps >= 1)) return null;
  const maxReps = 30 * (anchorKg / loadKg - 1);
  return Math.min(10, Math.max(0, maxReps - reps));
}

/** Logged RPE first, then the e1RM estimate, else unknown. */
export function setRir(set: EnrichedSet, anchorKg: number | null): number | null {
  if (set.rpe !== null && Number.isFinite(set.rpe)) return Math.max(0, 10 - set.rpe);
  if (set.isUnloaded) return null;
  return estimateRir(set.effectiveLoadKg, set.reps, anchorKg);
}

/** How many hard sets one logged set is worth before muscle weighting. */
export function setStimulus(set: EnrichedSet, anchorKg: number | null): number {
  if (set.setKind === 'warmup') return FATIGUE_WARMUP_WEIGHT;
  return rirWeight(setRir(set, anchorKg));
}

/** Muscle -> share of a set. Primary 1, secondaries 0.5, duplicates keep the larger. */
export function muscleWeights(primary: Muscle, secondary: readonly Muscle[]): Map<TrackedMuscle, number> {
  const out = new Map<TrackedMuscle, number>();
  const put = (m: Muscle, w: number) => {
    if (m === 'full-body' || m === 'unknown') return;
    out.set(m, Math.max(out.get(m) ?? 0, w));
  };
  for (const m of secondary) put(m, FATIGUE_SECONDARY_WEIGHT);
  put(primary, 1);
  return out;
}

// --- stimuli: everything that does not depend on "when are we looking" ------------

/** One session's deposit on one muscle. */
export type Stimulus = {
  /** Session start, epoch ms. */
  at: number;
  /** Weighted hard sets, capped per session. */
  sets: number;
  /** sets / 8 x the familiarity gain: what decays. */
  stimulus: number;
  /** An exercise still tagged by guesswork contributed. */
  unconfirmed: boolean;
};

export type FatigueStimuli = {
  /** Per muscle, oldest first. A muscle a session did not touch has no entry for it. */
  byMuscle: ReadonlyMap<TrackedMuscle, readonly Stimulus[]>;
  /** Working sets whose exercise names no muscle (unknown, full-body), per session. */
  unmapped: ReadonlyArray<{ at: number; sets: number }>;
};

/** Local calendar day as an integer, DST-proof thanks to the rounding. */
function dayNumber(t: number): number {
  return Math.round(startOfDay(new Date(t)).getTime() / DAY);
}

type Session = { at: number; sets: EnrichedSet[] };

/** Sets grouped by workout, oldest first. A session's time is its earliest set. */
function sessionsOf(sets: EnrichedSet[]): Session[] {
  const by = new Map<string, Session>();
  for (const s of sets) {
    const t = s.date.getTime();
    const cur = by.get(s.workoutId);
    if (cur) {
      cur.sets.push(s);
      if (t < cur.at) cur.at = t;
    } else by.set(s.workoutId, { at: t, sets: [s] });
  }
  return [...by.values()].sort((a, b) => a.at - b.at);
}

export function fatigueStimuli(sets: EnrichedSet[], meta: MetaLookup): FatigueStimuli {
  // Best e1RM per exercise, as (time, value) points, for the RIR anchor.
  const e1rms = new Map<string, Array<{ at: number; kg: number }>>();
  for (const s of sets) {
    if (s.setKind === 'warmup') continue;
    const kg = e1rm(s);
    if (kg === null) continue;
    const list = e1rms.get(s.canonicalName) ?? [];
    list.push({ at: s.date.getTime(), kg });
    e1rms.set(s.canonicalName, list);
  }
  const anchorAt = (name: string, at: number): number | null => {
    let best: number | null = null;
    for (const p of e1rms.get(name) ?? []) {
      if (p.at > at || p.at < at - FATIGUE_E1RM_WINDOW_DAYS * DAY) continue;
      if (best === null || p.kg > best) best = p.kg;
    }
    return best;
  };

  // Pass 1: capped weighted sets per muscle per session.
  type Raw = { at: number; day: number; sets: number; unconfirmed: boolean };
  const raw = new Map<TrackedMuscle, Raw[]>();
  const unmapped: Array<{ at: number; sets: number }> = [];
  for (const session of sessionsOf(sets)) {
    const effective = new Map<TrackedMuscle, number>();
    const guessed = new Set<TrackedMuscle>();
    let unnamed = 0;
    for (const s of session.sets) {
      const m = meta(s.canonicalName);
      const weights = m ? muscleWeights(m.primaryMuscle, m.secondaryMuscles) : new Map<TrackedMuscle, number>();
      if (weights.size === 0) {
        if (s.setKind !== 'warmup') unnamed++;
        continue;
      }
      const stimulus = setStimulus(s, anchorAt(s.canonicalName, s.date.getTime()));
      for (const [muscle, w] of weights) {
        effective.set(muscle, (effective.get(muscle) ?? 0) + stimulus * w);
        if (!s.metaConfirmed) guessed.add(muscle);
      }
    }
    if (unnamed > 0) unmapped.push({ at: session.at, sets: unnamed });
    const day = dayNumber(session.at);
    for (const [muscle, v] of effective) {
      const list = raw.get(muscle) ?? [];
      list.push({
        at: session.at,
        day,
        sets: Math.min(FATIGUE_MAX_SETS_PER_SESSION, v),
        unconfirmed: guessed.has(muscle),
      });
      raw.set(muscle, list);
    }
  }

  // Pass 2: the familiarity gain, from calendar weeks before each session.
  const byMuscle = new Map<TrackedMuscle, Stimulus[]>();
  for (const [muscle, list] of raw) {
    byMuscle.set(
      muscle,
      list.map((cur) => {
        let acute = 0;
        let before = 0;
        for (const p of list) {
          if (p.at > cur.at) break;
          const ago = cur.day - p.day;
          if (ago < FATIGUE_ACUTE_DAYS) acute += p.sets;
          else if (ago < FATIGUE_ACUTE_DAYS * (1 + FATIGUE_BASELINE_WEEKS)) before += p.sets;
        }
        const baseline = before / FATIGUE_BASELINE_WEEKS;
        const gain = Math.min(
          FATIGUE_GAIN_MAX,
          Math.max(
            FATIGUE_GAIN_MIN,
            (acute + FATIGUE_NOVICE_WEEKLY_SETS) / (baseline + FATIGUE_NOVICE_WEEKLY_SETS),
          ),
        );
        return {
          at: cur.at,
          sets: cur.sets,
          stimulus: (cur.sets / FATIGUE_SETS_PER_UNIT) * gain,
          unconfirmed: cur.unconfirmed,
        };
      }),
    );
  }
  return { byMuscle, unmapped };
}

/** Decayed residue x at time t: only sessions at or before t, within the lookback. */
function residueAt(list: readonly Stimulus[], muscle: TrackedMuscle, t: number): number {
  const halfLife = FATIGUE_HALF_LIFE_HOURS[muscle] * HOUR;
  let x = 0;
  for (const s of list) {
    if (s.at > t) break;
    if (s.at < t - FATIGUE_LOOKBACK_DAYS * DAY) continue;
    x += s.stimulus * halfLifeDecay(t - s.at, halfLife);
  }
  return x;
}

/** Fatigue 0..1 of one muscle at time t. */
export function fatigueAt(stimuli: FatigueStimuli, muscle: TrackedMuscle, t: number): number {
  return 1 - Math.exp(-residueAt(stimuli.byMuscle.get(muscle) ?? [], muscle, t));
}

// --- one moment ---------------------------------------------------------------

export type MuscleFatigue = {
  muscle: TrackedMuscle;
  /** 0..1. */
  value: number;
  level: FatigueLevel;
  state: FatigueState;
  /** Last session at or before `asOf` that trained it, any lookback. Null if never. */
  lastTrained: Date | null;
  /** Weighted hard sets in the 7 days up to `asOf`. */
  hardSets7d: number;
  /** Hours from `asOf` until it drops below READY_BELOW with no more training; 0 if ready. */
  hoursToReady: number;
  /** True when an exercise still tagged by guesswork contributed. */
  unconfirmed: boolean;
};

export type RecoveryResult = {
  muscles: MuscleFatigue[];
  /** Working sets in the lookback whose exercise names no muscle (unknown, full-body). */
  unmappedSets: number;
};

/** Read every muscle off precomputed stimuli at one moment. */
export function fatigueFrom(stimuli: FatigueStimuli, asOf: Date): RecoveryResult {
  const now = asOf.getTime();
  const lookback = now - FATIGUE_LOOKBACK_DAYS * DAY;
  const muscles = TRACKED_MUSCLES.map((muscle): MuscleFatigue => {
    const list = stimuli.byMuscle.get(muscle) ?? [];
    const residue = residueAt(list, muscle, now);
    const value = 1 - Math.exp(-residue);
    let last: number | null = null;
    let week = 0;
    let guessed = false;
    for (const s of list) {
      if (s.at > now) break;
      last = s.at;
      if (s.at > now - FATIGUE_ACUTE_DAYS * DAY) week += s.sets;
      if (s.at >= lookback && s.unconfirmed) guessed = true;
    }
    return {
      muscle,
      value,
      level: fatigueLevelOf(value),
      state: fatigueStateOf(value),
      lastTrained: last === null ? null : new Date(last),
      hardSets7d: week,
      hoursToReady: hoursUntilReady(residue, FATIGUE_HALF_LIFE_HOURS[muscle]),
      unconfirmed: value > 0 && guessed,
    };
  });
  let unmappedSets = 0;
  for (const u of stimuli.unmapped) if (u.at <= now && u.at >= lookback) unmappedSets += u.sets;
  return { muscles, unmappedSets };
}

export function muscleFatigue(sets: EnrichedSet[], meta: MetaLookup, asOf: Date): RecoveryResult {
  return fatigueFrom(fatigueStimuli(sets, meta), asOf);
}

/**
 * Closed form: residue x decays as x * 0.5^(t/h), and fatigue < READY_BELOW
 * once x < -ln(1 - READY_BELOW). Solve for t.
 */
export function hoursUntilReady(residue: number, halfLifeHours: number): number {
  const limit = -Math.log(1 - READY_BELOW);
  if (residue <= limit) return 0;
  return halfLifeHours * Math.log2(residue / limit);
}

/** Whether `last` is too far behind `now` to read the map as "today". */
export function isStale(last: Date, now: Date): boolean {
  return now.getTime() - last.getTime() > STALE_AFTER_DAYS * DAY;
}

// --- what to train ------------------------------------------------------------

export const TRAINING_GROUPS = ['push', 'pull', 'legs', 'core'] as const;
export type TrainingGroup = (typeof TRAINING_GROUPS)[number];

/**
 * The muscles that decide whether a group is ready: the main movers only, so a
 * pair of forearms tired from deadlift grip does not declare "pull" off limits.
 */
export const GROUP_MOVERS: Record<TrainingGroup, readonly TrackedMuscle[]> = {
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'lats', 'biceps'],
  legs: ['quads', 'hamstrings', 'glutes'],
  core: ['abs', 'obliques', 'lower-back'],
};

export type GroupReadiness = {
  group: TrainingGroup;
  state: FatigueState;
  value: number;
  hoursToReady: number;
  /** The most fatigued mover: what the group is waiting on. */
  limiting: TrackedMuscle;
};

export function groupReadiness(muscles: readonly MuscleFatigue[]): GroupReadiness[] {
  const of = new Map(muscles.map((m) => [m.muscle, m]));
  return TRAINING_GROUPS.map((group) => {
    let worst: MuscleFatigue | null = null;
    for (const m of GROUP_MOVERS[group]) {
      const f = of.get(m);
      if (f && (worst === null || f.value > worst.value)) worst = f;
    }
    return {
      group,
      state: worst?.state ?? 'ready',
      value: worst?.value ?? 0,
      hoursToReady: worst?.hoursToReady ?? 0,
      limiting: worst?.muscle ?? GROUP_MOVERS[group][0]!,
    };
  });
}

// --- weekly volume ------------------------------------------------------------

export type VolumeStatus = 'under' | 'in' | 'over';
export type WeeklyVolume = { muscle: TrackedMuscle; sets: number; status: VolumeStatus };

export function volumeStatus(sets: number): VolumeStatus {
  if (sets < WEEKLY_SETS_TARGET.low) return 'under';
  if (sets > WEEKLY_SETS_TARGET.high) return 'over';
  return 'in';
}

/**
 * Hard sets in the last 7 days against the guide band, for muscles trained at
 * all in the last 28 -- a never-trained neck is a choice, not a shortfall.
 * Most sets first.
 */
export function weeklyVolume(muscles: readonly MuscleFatigue[], asOf: Date): WeeklyVolume[] {
  const since = asOf.getTime() - 28 * DAY;
  return muscles
    .filter((m) => m.lastTrained !== null && m.lastTrained.getTime() >= since)
    .map((m) => ({ muscle: m.muscle, sets: m.hardSets7d, status: volumeStatus(m.hardSets7d) }))
    .sort((a, b) => b.sets - a.sets);
}

// --- history ------------------------------------------------------------------

export type FatigueHistoryRow = {
  muscle: TrackedMuscle;
  /** Fatigue at the end of each day (the last day: at `end`). */
  values: number[];
  /** A session trained it that day. */
  trained: boolean[];
  /** A session that day trained it while it was already fatigued. */
  overreached: boolean[];
  /** Sessions in the window that went in fatigued. */
  overreachCount: number;
};

export type FatigueHistory = {
  /** Start of each day, oldest first. */
  days: Date[];
  /** Muscles trained at least once in the window, in TRACKED_MUSCLES order. */
  rows: FatigueHistoryRow[];
  /** Muscle-sessions in the window, i.e. (session, muscle) pairs with at least one weighted set. */
  muscleSessions: number;
  /** Of those, how many started with the muscle already fatigued. */
  whileFatigued: number;
};

/**
 * Fatigue per muscle per day for the `days` days ending at `end`, and how often
 * a muscle was trained before it had recovered out of "fatigued". Training while
 * merely "recovering" is normal and not counted.
 */
export function fatigueHistory(stimuli: FatigueStimuli, end: Date, days = 42): FatigueHistory {
  const endMs = end.getTime();
  const lastDay = startOfDay(end);
  const dayStarts: Date[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(lastDay);
    d.setDate(d.getDate() - i);
    dayStarts.push(d);
  }
  const first = dayStarts[0]!.getTime();
  const indexOf = (t: number) => {
    const n = dayNumber(t) - dayNumber(first);
    return n >= 0 && n < days ? n : -1;
  };

  const rows: FatigueHistoryRow[] = [];
  let muscleSessions = 0;
  let whileFatigued = 0;
  for (const muscle of TRACKED_MUSCLES) {
    const list = stimuli.byMuscle.get(muscle) ?? [];
    const inWindow = list.filter((s) => s.at >= first && s.at <= endMs);
    if (inWindow.length === 0) continue;
    const trained = new Array<boolean>(days).fill(false);
    const overreached = new Array<boolean>(days).fill(false);
    let overreachCount = 0;
    for (const s of inWindow) {
      const i = indexOf(s.at);
      if (i < 0) continue;
      trained[i] = true;
      if (s.sets < 1) continue;
      muscleSessions++;
      if (fatigueAt(stimuli, muscle, s.at - 1) >= FATIGUED_FROM) {
        overreached[i] = true;
        overreachCount++;
        whileFatigued++;
      }
    }
    const values = dayStarts.map((d, i) => {
      const dayEnd = i === days - 1 ? endMs : d.getTime() + DAY - 1;
      return fatigueAt(stimuli, muscle, Math.min(dayEnd, endMs));
    });
    rows.push({ muscle, values, trained, overreached, overreachCount });
  }
  return { days: dayStarts, rows, muscleSessions, whileFatigued };
}
