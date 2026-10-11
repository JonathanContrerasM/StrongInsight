import { describe, expect, it } from 'vitest';
import BODY_PATHS from './bodyPaths';
import { INERT_REGIONS, REGIONS_OF, regionFatigue } from './bodyRegions';
import { TRACKED_MUSCLES, type MuscleFatigue } from '../derive/recovery';

/**
 * Locks the hand-written mapping to the generated geometry: regenerating the
 * paths from a newer MuscleMap must not silently leave a muscle undrawn or a
 * drawn muscle permanently grey.
 */
describe('body regions', () => {
  for (const figure of ['male', 'female'] as const) {
    const drawn = new Set([
      ...Object.keys(BODY_PATHS[figure].front.paths),
      ...Object.keys(BODY_PATHS[figure].back.paths),
    ]);

    it(`draws every tracked muscle on the ${figure} figure`, () => {
      for (const m of TRACKED_MUSCLES) {
        expect(
          REGIONS_OF[m].some((r) => drawn.has(r)),
          m + ' has no drawn region',
        ).toBe(true);
      }
    });

    it(`colours every non-inert ${figure} region from some muscle`, () => {
      const targeted = new Set(Object.values(REGIONS_OF).flat());
      for (const r of drawn) {
        if (INERT_REGIONS.has(r)) continue;
        expect(targeted.has(r), r + ' is drawn but nothing colours it').toBe(true);
      }
    });
  }

  it('puts the most fatigued muscle first on a shared region', () => {
    const f = (muscle: MuscleFatigue['muscle'], value: number): MuscleFatigue => ({
      muscle,
      value,
      level: 0,
      state: 'ready',
      lastTrained: null,
      hardSets7d: 0,
      hoursToReady: 0,
      unconfirmed: false,
    });
    const map = regionFatigue([f('back', 0.2), f('lats', 0.6), f('chest', 0.1)]);
    expect(map.get('upper-back')?.map((m) => m.muscle)).toEqual(['lats', 'back']);
    expect(map.get('chest')?.length).toBe(1);
  });
});
