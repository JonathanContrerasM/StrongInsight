import type { EnrichedSet } from '../model/effectiveLoad';
import type { Equipment, LoadType } from '../model/types';
// The first value import from meta/ in this layer. The rule in the README is
// that `src/ingest` must not reach into `src/meta` -- a performance rule, so a
// tag edit cannot trigger a re-parse. It does not apply here: derive already
// re-runs on metadata changes by design. And sharing the one normalisation is
// the point, since a private copy would silently drift from the canonical one
// and start splitting pairs that used to match.
import { normaliseName } from '../meta/guessMeta';
import { volume, summariseAll } from './index';
import { type MetaLookup } from './balance';
import { daysBetween } from './buckets';
import { repDensity, type RepBin } from './profile';
import { sessionBests } from './series';
import { median, slopeWithError, zCritical } from './stats';

/**
 * Comparing two people's exports.
 *
 * Most of what you would naturally compare is meaningless, and saying so is the
 * feature. Measured on the reference corpus split in half -- the friendliest
 * possible case, one person and one exercise vocabulary -- overlap was 0.48
 * Jaccard and only 26 of 130 exercises had enough history on both sides to
 * compare at all. Between two different people it is worse.
 *
 * Two refusals do the heavy lifting:
 *
 *   1. Machine and cable loads do not compare across gyms. 126 kg on one
 *      manufacturer's leg-extension stack is not 126 kg on another's, and a
 *      cable stack's label depends on the pulley ratio. Free weights and
 *      bodyweight mean the same thing everywhere; nothing else does.
 *   2. Bodyweight movements need both people's bodyweight. A pull-up logged at
 *      "0 kg" is a different amount of work for two different people, and the
 *      workout export does not carry it.
 *
 * And one estimator choice. The obvious headline is each person's best e1RM, but
 * a max is biased by sample size: subsampling the reference corpus 400 times,
 * the best squat e1RM climbed 123.1 -> 129.8 -> 133.3 kg as sessions went 5 ->
 * 20 -> 51, while the MEDIAN session best sat at 107.4 -> 107.9 -> 108.0. So the
 * headline is the median session best, and the PR is shown beside it carrying
 * its attempt count.
 */

/** Equipment whose load means the same thing in any gym. */
const PORTABLE_LOAD: ReadonlySet<Equipment> = new Set<Equipment>([
  'barbell',
  'dumbbell',
  'kettlebell',
  'plate',
  'bodyweight',
]);

/** Load types whose effective load depends on knowing the lifter's bodyweight. */
const NEEDS_BODYWEIGHT: ReadonlySet<LoadType> = new Set<LoadType>([
  'bodyweight',
  'bodyweight-plus',
  'assisted',
]);

/** Sessions with a usable e1RM needed on BOTH sides before a lift is compared. */
export const MIN_SHARED_SESSIONS = 3;
/** Sessions and span needed before a progression slope is worth fitting. */
export const MIN_SLOPE_POINTS = 8;
export const MIN_SLOPE_DAYS = 42;
/** Sessions before "they do this and you do not" is a habit rather than a try. */
export const MIN_HABIT_SESSIONS = 4;

const ALPHA = 0.05;

export type Corpus = {
  label: string;
  sets: EnrichedSet[];
  meta: MetaLookup;
  /** null when unknown. Gates every bodyweight-dependent comparison. */
  bodyweightKg: number | null;
};

/** Why a shared lift could not be put in the strength table. */
export type Excluded =
  | 'machine-or-cable'
  | 'unknown-equipment'
  | 'needs-bodyweight'
  | 'not-enough-history';

export type LiftRow = {
  name: string;
  equipment: Equipment;
  /** Median session-best e1RM. Stable across differing sample sizes. */
  youKg: number;
  themKg: number;
  /** Best single session. Biased upward by attempt count -- always shown with n. */
  youPeakKg: number;
  themPeakKg: number;
  youSessions: number;
  themSessions: number;
  /** themKg / youKg. 1 means level. */
  ratio: number;
  /** The same ratio after dividing each by their own bodyweight, when known. */
  relativeRatio: number | null;
};

export type SlopeRow = {
  name: string;
  youKgPerMonth: number;
  themKgPerMonth: number;
  /** True when the difference in slopes clears the corrected threshold. */
  significant: boolean;
};

export type Shape = {
  label: string;
  sessions: number;
  weeks: number;
  sessionsPerWeek: number;
  setsPerSession: number;
  volumePerWeekKg: number;
  medianSessionMinutes: number | null;
  /** Share of volume by muscle, summing to 1 over known muscles. */
  muscleShare: Array<{ group: string; share: number }>;
  reps: RepBin[];
  from: Date | null;
  to: Date | null;
};

export type Comparison = {
  you: Shape;
  them: Shape;
  sharedNames: string[];
  yoursOnly: string[];
  theirsOnly: string[];
  /** Shared lifts that survived every gate. */
  lifts: LiftRow[];
  /** Shared lifts that did not, with the reason. */
  excluded: Array<{ name: string; reason: Excluded }>;
  slopes: SlopeRow[];
  /** Lifts they train regularly that have no counterpart in your history. */
  theyDoYouDont: Array<{ name: string; sessions: number }>;
  /** True when both bodyweights were supplied. */
  bodyweightKnown: boolean;
};

// --- helpers ------------------------------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function sessionDays(sets: EnrichedSet[]): Date[] {
  const seen = new Map<number, Date>();
  for (const s of sets) {
    const d = startOfDay(s.date);
    seen.set(d.getTime(), d);
  }
  return [...seen.values()].sort((a, b) => a.getTime() - b.getTime());
}

function byCanonical(sets: EnrichedSet[]): Map<string, EnrichedSet[]> {
  const m = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    const list = m.get(s.canonicalName);
    if (list) list.push(s);
    else m.set(s.canonicalName, [s]);
  }
  return m;
}

/** Usable session-best e1RMs for one lift, oldest first. */
function bests(sets: EnrichedSet[]): Array<{ date: Date; kg: number }> {
  return sessionBests(sets)
    .filter((b) => b.bestE1rmKg !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((b) => ({ date: b.date, kg: b.bestE1rmKg as number }));
}

/** kg per month, or null when the series cannot support a fit. */
function slopePerMonth(
  points: Array<{ date: Date; kg: number }>,
): { perMonth: number; z: number } | null {
  if (points.length < MIN_SLOPE_POINTS) return null;
  const first = points[0]?.date as Date;
  const last = points[points.length - 1]?.date as Date;
  if (daysBetween(first, last) < MIN_SLOPE_DAYS) return null;
  const fit = slopeWithError(points.map((p) => ({ x: daysBetween(first, p.date), y: p.kg })));
  if (fit === null) return null;
  return { perMonth: fit.slope * 30, z: fit.z };
}

function shapeOf(corpus: Corpus): Shape {
  const days = sessionDays(corpus.sets);
  const first = days[0] ?? null;
  const last = days[days.length - 1] ?? null;
  // Inclusive day count: ten weekly sessions cover ten weeks, not the nine that
  // the gaps between them would suggest. At least one week, so a single-session
  // corpus does not divide by zero.
  const weeks = first && last ? Math.max(1, (daysBetween(first, last) + 1) / 7) : 1;

  const workouts = new Set(corpus.sets.map((s) => s.workoutId));
  const vol = volume(corpus.sets);

  // Volume share by muscle, over sets whose muscle is actually known.
  const byMuscle = new Map<string, number>();
  let known = 0;
  for (const s of corpus.sets) {
    const m = corpus.meta(s.canonicalName);
    if (!m || m.primaryMuscle === 'unknown') continue;
    const load = s.effectiveLoadKg;
    const reps = s.reps;
    if (load === null || reps === null) continue;
    const v = load * reps;
    byMuscle.set(m.primaryMuscle, (byMuscle.get(m.primaryMuscle) ?? 0) + v);
    known += v;
  }
  const muscleShare = [...byMuscle.entries()]
    .map(([group, v]) => ({ group, share: known > 0 ? v / known : 0 }))
    .sort((a, b) => b.share - a.share);

  return {
    label: corpus.label,
    sessions: days.length,
    weeks,
    sessionsPerWeek: days.length / weeks,
    setsPerSession: workouts.size > 0 ? corpus.sets.length / workouts.size : 0,
    volumePerWeekKg: vol.volumeKg / weeks,
    // Durations live on Workout, which derive/ never sees. Left null rather than
    // faked; the view can fill it in from the store when it has it.
    medianSessionMinutes: null,
    muscleShare,
    reps: repDensity(corpus.sets),
    from: first,
    to: last,
  };
}

// --- the comparison -----------------------------------------------------------

export function compareCorpora(you: Corpus, them: Corpus): Comparison {
  const yourLifts = byCanonical(you.sets);
  const theirLifts = byCanonical(them.sets);

  /**
   * Match on canonical name, falling back to a normalised form so casing,
   * punctuation and accents do not split a pair. Deliberately NOT fuzzy: an
   * unmatched lift is reported as unmatched, never guessed into a pairing that
   * would quietly compare two different movements.
   */
  const theirByNorm = new Map<string, string>();
  for (const name of theirLifts.keys()) theirByNorm.set(normaliseName(name), name);

  const sharedNames: string[] = [];
  const yoursOnly: string[] = [];
  /** your canonical name -> their canonical name */
  const pairing = new Map<string, string>();

  for (const name of yourLifts.keys()) {
    const match = theirLifts.has(name) ? name : theirByNorm.get(normaliseName(name));
    if (match === undefined) {
      yoursOnly.push(name);
      continue;
    }
    sharedNames.push(name);
    pairing.set(name, match);
  }
  const matched = new Set(pairing.values());
  const theirsOnly = [...theirLifts.keys()].filter((n) => !matched.has(n));

  const bodyweightKnown = you.bodyweightKg !== null && them.bodyweightKg !== null;

  const lifts: LiftRow[] = [];
  const excluded: Array<{ name: string; reason: Excluded }> = [];
  const slopes: SlopeRow[] = [];
  /** Slope pairs held back until the family size is known -- see the gate below. */
  const slopeCandidates: Array<{ name: string; you: number; them: number; z: number }> = [];

  for (const name of sharedNames) {
    const theirName = pairing.get(name) as string;
    const yourSets = yourLifts.get(name) ?? [];
    const theirSets = theirLifts.get(theirName) ?? [];

    const meta = you.meta(name) ?? them.meta(theirName);
    const equipment: Equipment = meta?.equipment ?? 'unknown';
    const loadType: LoadType = meta?.loadType ?? 'external';

    /**
     * Load type first, equipment second -- the order matters.
     *
     * Strong only states equipment in a trailing parenthetical, so "Pull Up",
     * "Chest Dip" and "Muscle Up" all infer `equipment: 'unknown'` while
     * correctly inferring `loadType: 'bodyweight-plus'`. Checking equipment
     * first would file every one of them as a machine.
     */
    if (NEEDS_BODYWEIGHT.has(loadType)) {
      // The load IS the lifter's body, which is a universal unit -- provided we
      // know what both of them weigh.
      if (!bodyweightKnown) {
        excluded.push({ name, reason: 'needs-bodyweight' });
        continue;
      }
    } else if (!PORTABLE_LOAD.has(equipment)) {
      // An external load only means the same thing in two gyms if it is a free
      // weight. `unknown` is its own reason rather than an accusation: "Leg
      // Press" really is a machine, but "Triceps Extension" reads identically
      // and might be a dumbbell, so neither can be verified.
      excluded.push({
        name,
        reason: equipment === 'unknown' || equipment === 'other'
          ? 'unknown-equipment'
          : 'machine-or-cable',
      });
      continue;
    }

    const a = bests(yourSets);
    const b = bests(theirSets);
    if (a.length < MIN_SHARED_SESSIONS || b.length < MIN_SHARED_SESSIONS) {
      excluded.push({ name, reason: 'not-enough-history' });
      continue;
    }

    const youKg = median(a.map((p) => p.kg)) as number;
    const themKg = median(b.map((p) => p.kg)) as number;
    if (!(youKg > 0) || !(themKg > 0)) {
      excluded.push({ name, reason: 'not-enough-history' });
      continue;
    }

    lifts.push({
      name,
      equipment,
      youKg,
      themKg,
      youPeakKg: Math.max(...a.map((p) => p.kg)),
      themPeakKg: Math.max(...b.map((p) => p.kg)),
      youSessions: a.length,
      themSessions: b.length,
      ratio: themKg / youKg,
      relativeRatio:
        bodyweightKnown && you.bodyweightKg && them.bodyweightKg
          ? themKg / them.bodyweightKg / (youKg / you.bodyweightKg)
          : null,
    });

    const sa = slopePerMonth(a);
    const sb = slopePerMonth(b);
    if (sa && sb) {
      slopeCandidates.push({ name, you: sa.perMonth, them: sb.perMonth, z: sb.z - sa.z });
    }
  }

  /**
   * Comparing slopes across N lifts is N tests, and without a correction one of
   * them always looks like somebody is pulling ahead. Same standard as the
   * Improvements tab rather than a second, softer one.
   */
  const threshold = zCritical(ALPHA / Math.max(1, slopeCandidates.length));
  for (const s of slopeCandidates) {
    slopes.push({
      name: s.name,
      youKgPerMonth: s.you,
      themKgPerMonth: s.them,
      significant: Math.abs(s.z) >= threshold,
    });
  }

  // Their habits with no counterpart in your history. Needs no normalisation of
  // any kind, which makes it the most directly usable thing on the tab.
  const theirSummaries = new Map(summariseAll(them.sets).map((s) => [s.name, s]));
  const theyDoYouDont = theirsOnly
    .map((name) => ({
      name,
      sessions: new Set((theirLifts.get(name) ?? []).map((s) => s.workoutId)).size,
      summary: theirSummaries.get(name),
    }))
    .filter((x) => x.sessions >= MIN_HABIT_SESSIONS)
    .map(({ name, sessions }) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions);

  lifts.sort((a, b) => b.ratio - a.ratio);
  slopes.sort((a, b) => b.themKgPerMonth - b.youKgPerMonth - (a.themKgPerMonth - a.youKgPerMonth));

  return {
    you: shapeOf(you),
    them: shapeOf(them),
    sharedNames: sharedNames.sort((a, b) => a.localeCompare(b)),
    yoursOnly: yoursOnly.sort((a, b) => a.localeCompare(b)),
    theirsOnly: theirsOnly.sort((a, b) => a.localeCompare(b)),
    lifts,
    excluded: excluded.sort((a, b) => a.name.localeCompare(b.name)),
    slopes,
    theyDoYouDont,
    bodyweightKnown,
  };
}
