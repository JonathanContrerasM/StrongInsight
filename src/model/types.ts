/** Canonical domain types. See README "CSV quirks" for why several of these look odd. */

export type WeightUnit = 'kg' | 'lb';

export const LOAD_TYPES = [
  'external',
  'bodyweight',
  'bodyweight-plus',
  'assisted',
  'duration',
  'distance',
] as const;
export type LoadType = (typeof LOAD_TYPES)[number];

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'machine',
  'cable',
  'bodyweight',
  'kettlebell',
  'plate',
  'band',
  'other',
  'unknown',
] as const;
export type Equipment = (typeof EQUIPMENT)[number];

export const MUSCLES = [
  'chest',
  'back',
  'lats',
  'traps',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'quads',
  'hamstrings',
  'glutes',
  'calves',
  'abs',
  'obliques',
  'lower-back',
  'adductors',
  'abductors',
  'neck',
  'full-body',
  'unknown',
] as const;
export type Muscle = (typeof MUSCLES)[number];

export const MOVEMENT_PATTERNS = [
  'horiz-push',
  'vert-push',
  'horiz-pull',
  'vert-pull',
  'squat',
  'hinge',
  'lunge',
  'carry',
  'isolation',
  'core',
  'unknown',
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export type SetKind = 'working' | 'warmup' | 'dropset';

/**
 * One logged set. Rest rows never appear here -- they are collapsed into
 * `restAfterSec` on the preceding set.
 *
 * `weightKg` is the RAW column value normalised to kg. Effective load is always
 * derived (see model/effectiveLoad.ts), never persisted, so that correcting a
 * loadType or a bodyweight entry retroactively fixes all history.
 */
export type SetRecord = {
  id: string;
  workoutId: string;
  date: Date;
  exerciseName: string;
  setKind: SetKind;
  /**
   * 1-based ordinal within (workoutId, exerciseName), counting warm-ups and drop
   * sets. NOT the CSV's set-order value -- W and D rows carry no ordinal.
   * FUTURE: a "top set" chart must re-rank on setKind === 'working'; setOrder === 1
   * does not mean "first working set".
   */
  setOrder: number;
  weightKg: number | null;
  reps: number | null;
  /**
   * RAW distance value, unit UNKNOWN -- deliberately not converted.
   * The fixture's `Running` rows read 0.8/1.0 against 420s/318s, which is plainly
   * kilometres, not the metres the unit setting claims. Multiplying by 1000 would
   * bake in a 1000x error. Excluded from every metric.
   */
  distanceRaw: number | null;
  seconds: number | null;
  rpe: number | null;
  notes: string;
  /** null means "unknown" (no rest row followed), never 0. */
  restAfterSec: number | null;
  /** External-load exercise logged at weight 0 -- real set, no quantifiable load. */
  isUnloaded: boolean;
};

/** Everything the parser can know without consulting metadata. */
export type ParsedSet = Omit<SetRecord, 'isUnloaded'>;

export type Workout = {
  id: string;
  date: Date;
  /** Strong's auto-generated time-of-day label. NOT a routine or split name. */
  name: string;
  durationSec: number;
  setIds: string[];
};

export type ExerciseMeta = {
  /** Join key: the trimmed CSV exercise name. */
  name: string;
  equipment: Equipment;
  loadType: LoadType;
  primaryMuscle: Muscle;
  secondaryMuscles: Muscle[];
  pattern: MovementPattern;
  unilateral: boolean;
  /** Merges renamed exercises into one history. Flattened in buildMetaIndex. */
  aliasOf?: string;
  /** false = heuristic guess awaiting user approval. */
  confirmed: boolean;
};

export type BodyweightEntry = { date: string; kg: number };

export type Settings = {
  inputUnit: WeightUnit;
  displayUnit: WeightUnit;
  weekStartsOn: 0 | 1;
  defaultBodyweightKg: number;
};

export const DEFAULT_SETTINGS: Settings = {
  inputUnit: 'kg',
  displayUnit: 'kg',
  weekStartsOn: 1,
  defaultBodyweightKg: 80,
};

export type RawImport = {
  text: string;
  importedAt: number;
  filename: string;
  /**
   * Unit this particular export was in. Recorded per-import, not globally:
   * Strong rewrites the ENTIRE history when the unit setting changes, so any one
   * export is internally consistent, but an archived export may differ from the
   * current one. Tagging each import prevents a silent 2.2x error.
   */
  unit: WeightUnit;
};
