import type { Equipment, ExerciseMeta, LoadType, MovementPattern, Muscle } from '../model/types';

/**
 * Pre-tagged metadata for the most frequently logged exercises, so a first run is
 * mostly correct rather than mostly empty.
 *
 * This is a starting-point OVERLAY, not a gate and not a closed universe:
 *  - every entry ships confirmed: false and still appears in the tagging tray
 *  - a name absent from this table is not rejected; it falls through to guessMeta
 *  - nothing in the app branches on whether a name appears here
 *
 * Entries are keyed by the exact (trimmed) CSV exercise name.
 */

type Seed = [
  name: string,
  equipment: Equipment,
  loadType: LoadType,
  primary: Muscle,
  pattern: MovementPattern,
  secondary?: Muscle[],
  unilateral?: boolean,
];

/** Ordered by set count in the reference corpus, highest impact first. */
const SEEDS: Seed[] = [
  ['Pull Up', 'bodyweight', 'bodyweight-plus', 'lats', 'vert-pull', ['biceps', 'back', 'forearms']],
  ['Squat (Barbell)', 'barbell', 'external', 'quads', 'squat', ['glutes', 'lower-back', 'hamstrings']],
  ['Push Up', 'bodyweight', 'bodyweight-plus', 'chest', 'horiz-push', ['triceps', 'shoulders', 'abs']],
  ['Bench Press (Barbell)', 'barbell', 'external', 'chest', 'horiz-push', ['triceps', 'shoulders']],
  ['Lateral Raise (Dumbbell)', 'dumbbell', 'external', 'shoulders', 'isolation', ['traps']],
  ['Leg Extension (Machine)', 'machine', 'external', 'quads', 'isolation'],
  ['Triceps Extension', 'unknown', 'external', 'triceps', 'isolation'],
  ['Bicep Curl (Barbell)', 'barbell', 'external', 'biceps', 'isolation', ['forearms']],
  ['Overhead Press (Barbell)', 'barbell', 'external', 'shoulders', 'vert-push', ['triceps', 'abs']],
  ['Standing Calf Raise (Bodyweight)', 'bodyweight', 'bodyweight-plus', 'calves', 'isolation'],
  ['Seated Row (Cable)', 'cable', 'external', 'back', 'horiz-pull', ['lats', 'biceps', 'traps']],
  ['Chest Dip', 'bodyweight', 'bodyweight-plus', 'chest', 'vert-push', ['triceps', 'shoulders']],
  ['Incline Bench Press (Dumbbell)', 'dumbbell', 'external', 'chest', 'horiz-push', ['shoulders', 'triceps']],
  ['Bicep Curl (Dumbbell)', 'dumbbell', 'external', 'biceps', 'isolation', ['forearms']],
  ['Bench Press (Dumbbell)', 'dumbbell', 'external', 'chest', 'horiz-push', ['triceps', 'shoulders']],
  ['Deadlift (Barbell)', 'barbell', 'external', 'hamstrings', 'hinge', ['glutes', 'lower-back', 'traps', 'forearms']],
  ['Incline Bench Press (Barbell)', 'barbell', 'external', 'chest', 'horiz-push', ['shoulders', 'triceps']],
  ['Hip Abductor (Machine)', 'machine', 'external', 'abductors', 'isolation', ['glutes']],
  ['Triceps Pushdown (Cable - Straight Bar)', 'cable', 'external', 'triceps', 'isolation'],
  ['Chin Up', 'bodyweight', 'bodyweight-plus', 'lats', 'vert-pull', ['biceps', 'back']],
  ['Hip Adductor (Machine)', 'machine', 'external', 'adductors', 'isolation'],
  ['Chest Fly', 'unknown', 'external', 'chest', 'isolation', ['shoulders']],
  ['Seated Calf Raise (Machine)', 'machine', 'external', 'calves', 'isolation'],
  ['Muscle Up', 'bodyweight', 'bodyweight-plus', 'lats', 'vert-pull', ['biceps', 'chest', 'triceps', 'abs']],
  ['Squat (Bodyweight)', 'bodyweight', 'bodyweight-plus', 'quads', 'squat', ['glutes']],
  ['Lunge (Barbell)', 'barbell', 'external', 'quads', 'lunge', ['glutes', 'hamstrings'], true],
  ['Push Up Ring', 'bodyweight', 'bodyweight-plus', 'chest', 'horiz-push', ['triceps', 'shoulders', 'abs']],
  ['Leg Press', 'machine', 'external', 'quads', 'squat', ['glutes', 'hamstrings']],
  ['Shrug (Dumbbell)', 'dumbbell', 'external', 'traps', 'isolation', ['forearms']],
  ['Hammer Curl (Dumbbell)', 'dumbbell', 'external', 'forearms', 'isolation', ['biceps']],
  ['Reverse Curl (Barbell)', 'barbell', 'external', 'forearms', 'isolation', ['biceps']],
  ['Handstand Hold', 'bodyweight', 'duration', 'shoulders', 'vert-push', ['abs', 'triceps']],
  ['Back Extension', 'bodyweight', 'bodyweight-plus', 'lower-back', 'hinge', ['glutes', 'hamstrings']],
  ['Single Triceps Extension', 'unknown', 'external', 'triceps', 'isolation', [], true],
  ['Bicep Curl (Cable)', 'cable', 'external', 'biceps', 'isolation', ['forearms']],
  ['Hip Thrust (Barbell)', 'barbell', 'external', 'glutes', 'hinge', ['hamstrings']],
  ['Face Pull (Cable)', 'cable', 'external', 'shoulders', 'horiz-pull', ['traps', 'back']],
  ['Push Up Close', 'bodyweight', 'bodyweight-plus', 'triceps', 'horiz-push', ['chest', 'shoulders']],
  ['Seated Calf Raise (Plate Loaded)', 'machine', 'external', 'calves', 'isolation'],
  ['Bulgarian Split Squat', 'unknown', 'external', 'quads', 'lunge', ['glutes', 'hamstrings'], true],
];

function toMeta(s: Seed): ExerciseMeta {
  const [name, equipment, loadType, primaryMuscle, pattern, secondary, unilateral] = s;
  return {
    name,
    equipment,
    loadType,
    primaryMuscle,
    secondaryMuscles: secondary ?? [],
    pattern,
    unilateral: unilateral ?? false,
    // Seeded, but still a guess the user has not approved.
    confirmed: false,
  };
}

export const SEED_META: Readonly<Record<string, ExerciseMeta>> = Object.freeze(
  Object.fromEntries(SEEDS.map((s) => [s[0], toMeta(s)])),
);

export function seedFor(name: string): ExerciseMeta | undefined {
  return SEED_META[name.trim()];
}

export const SEED_COUNT = SEEDS.length;
