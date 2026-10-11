import type { MuscleFatigue, TrackedMuscle } from '../derive/recovery';

/**
 * Our muscle tags -> the regions MuscleMap draws.
 *
 * The two vocabularies do not line up one to one. Strong-style tags split the
 * back into `back` and `lats`; the drawing has one upper-back shape. The drawing
 * has a rotator cuff; we file it under `shoulders`, the tag every press and rear
 * delt movement carries. `abductors` has no shape of its own and lands on the
 * glutes, where the outer hip is drawn.
 *
 * Where several muscles share a region the region shows the MOST fatigued of
 * them -- the conservative reading for a "should I rest this" map. The list
 * below the map still shows each muscle separately.
 */
export const REGIONS_OF: Record<TrackedMuscle, readonly string[]> = {
  chest: ['chest'],
  back: ['upper-back'],
  lats: ['upper-back'],
  traps: ['trapezius'],
  shoulders: ['deltoids', 'rotator-cuff'],
  biceps: ['biceps'],
  triceps: ['triceps'],
  forearms: ['forearm'],
  quads: ['quadriceps'],
  hamstrings: ['hamstring'],
  glutes: ['gluteal'],
  calves: ['calves'],
  abs: ['abs'],
  obliques: ['obliques'],
  'lower-back': ['lower-back'],
  adductors: ['adductors'],
  abductors: ['gluteal'],
  neck: ['neck'],
};

/** Drawn as silhouette only; no tag ever colours them. */
export const INERT_REGIONS: ReadonlySet<string> = new Set([
  'head',
  'hair',
  'hands',
  'feet',
  'ankles',
  'knees',
  'tibialis',
]);

export const MUSCLE_LABEL: Record<TrackedMuscle, string> = {
  chest: 'Chest',
  back: 'Upper back',
  lats: 'Lats',
  traps: 'Traps',
  shoulders: 'Shoulders',
  biceps: 'Biceps',
  triceps: 'Triceps',
  forearms: 'Forearms',
  quads: 'Quads',
  hamstrings: 'Hamstrings',
  glutes: 'Glutes',
  calves: 'Calves',
  abs: 'Abs',
  obliques: 'Obliques',
  'lower-back': 'Lower back',
  adductors: 'Adductors',
  abductors: 'Abductors',
  neck: 'Neck',
};

/** Region -> the muscles drawn on it, most fatigued first. */
export function regionFatigue(muscles: readonly MuscleFatigue[]): Map<string, MuscleFatigue[]> {
  const out = new Map<string, MuscleFatigue[]>();
  for (const m of muscles) {
    for (const region of REGIONS_OF[m.muscle]) {
      const list = out.get(region) ?? [];
      list.push(m);
      out.set(region, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => b.value - a.value);
  return out;
}
