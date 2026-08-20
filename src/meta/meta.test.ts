import { describe, it, expect } from 'vitest';
import { parseExerciseName, parseEquipment } from './equipment';
import { guessMeta } from './guessMeta';
import { buildMetaIndex } from './metaIndex';
import { SEED_META, SEED_COUNT, seedFor } from './seedMeta';
import { meta } from '../test/helpers';

describe('equipment parsing', () => {
  it('reads the trailing parenthetical', () => {
    expect(parseEquipment('Bench Press (Barbell)')).toBe('barbell');
    expect(parseEquipment('Lat Pulldown (Cable)')).toBe('cable');
    expect(parseEquipment('Leg Extension (Machine)')).toBe('machine');
    expect(parseEquipment('Standing Calf Raise (Bodyweight)')).toBe('bodyweight');
    expect(parseEquipment('Goblet Squat (Kettlebell)')).toBe('kettlebell');
  });

  it('handles a compound parenthetical', () => {
    const p = parseExerciseName('Triceps Pushdown (Cable - Straight Bar)');
    expect(p.equipment).toBe('cable');
    expect(p.base).toBe('Triceps Pushdown');
    expect(p.parenthetical).toBe('Cable - Straight Bar');
  });

  it('normalises the real-world misspelling "(Dumbell)"', () => {
    expect(parseEquipment('Bicep Curl Bench (Dumbell)')).toBe('dumbbell');
    expect(parseEquipment('Bicep Curl (Dumbbell)')).toBe('dumbbell');
  });

  it('maps plate-loaded and specialty bars onto their real family', () => {
    expect(parseEquipment('Seated Calf Raise (Plate Loaded)')).toBe('machine');
    expect(parseEquipment('Hammer Curl (Hammer Bar)')).toBe('barbell');
    expect(parseEquipment('Front Raise (Plate)')).toBe('plate');
  });

  it('does not mistake a variation parenthetical for equipment', () => {
    const p = parseExerciseName('Push Up (Knees)');
    expect(p.equipment).toBe('unknown');
    expect(p.parentheticalIsVariation).toBe(true);
    expect(p.base).toBe('Push Up');
  });

  it('handles names with no parenthetical at all', () => {
    const p = parseExerciseName('Pull Up');
    expect(p.equipment).toBe('unknown');
    expect(p.parenthetical).toBeNull();
    expect(p.base).toBe('Pull Up');
    expect(p.parentheticalIsVariation).toBe(false);
  });
});

describe('guessMeta', () => {
  it('treats pull ups and dips as bodyweight-plus', () => {
    for (const n of ['Pull Up', 'Chin Up', 'Muscle Up', 'Chest Dip', 'Push Up']) {
      expect(guessMeta(n).loadType, n).toBe('bodyweight-plus');
    }
  });

  it('classifies vertical pulls', () => {
    const g = guessMeta('Pull Up');
    expect(g.primaryMuscle).toBe('lats');
    expect(g.pattern).toBe('vert-pull');
  });

  it('disambiguates presses', () => {
    expect(guessMeta('Overhead Press (Barbell)').pattern).toBe('vert-push');
    expect(guessMeta('Bench Press (Barbell)').pattern).toBe('horiz-push');
    expect(guessMeta('Incline Bench Press (Dumbbell)').pattern).toBe('horiz-push');
    expect(guessMeta('Leg Press').pattern).toBe('squat');
  });

  it('does not let the generic curl rule capture a leg curl', () => {
    expect(guessMeta('Seated Leg Curl (Machine)').primaryMuscle).toBe('hamstrings');
    expect(guessMeta('Lying Leg Curl (Machine)').primaryMuscle).toBe('hamstrings');
    expect(guessMeta('Bicep Curl (Barbell)').primaryMuscle).toBe('biceps');
  });

  it('does not let the cardio rule capture a loaded carry', () => {
    const g = guessMeta('Farmer Walk');
    expect(g.pattern).toBe('carry');
    expect(g.loadType).not.toBe('distance');
  });

  it('treats holds as duration work excluded from load', () => {
    for (const n of ['Plank', 'Wall Sit', 'Handstand Hold', 'Side Plank', 'deadhang']) {
      expect(guessMeta(n).loadType, n).toBe('duration');
    }
  });

  it('detects assistance from the name, including the misspelling in real data', () => {
    expect(guessMeta('Pull Up One Arm Assited').loadType).toBe('assisted');
    expect(guessMeta('Assisted Pull Up').loadType).toBe('assisted');
  });

  it('detects unilateral work', () => {
    expect(guessMeta('Single Leg Press').unilateral).toBe(true);
    expect(guessMeta('Bent Over One Arm Row (Dumbbell)').unilateral).toBe(true);
    expect(guessMeta('Bench Press (Barbell)').unilateral).toBe(false);
  });

  it('uses what was logged when the name gives no signal', () => {
    const asDuration = guessMeta('Katana', {
      observedWeights: { anyNonZero: false, anySeconds: true, anyDistance: false },
    });
    expect(asDuration.loadType).toBe('duration');

    const asBodyweight = guessMeta('Katana', {
      observedWeights: { anyNonZero: false, anySeconds: false, anyDistance: false },
    });
    expect(asBodyweight.loadType).toBe('bodyweight-plus');

    const asExternal = guessMeta('Katana', {
      observedWeights: { anyNonZero: true, anySeconds: false, anyDistance: false },
    });
    expect(asExternal.loadType).toBe('external');
  });

  it('always returns something, marked unconfirmed', () => {
    const g = guessMeta('Completely Invented Movement');
    expect(g.confirmed).toBe(false);
    expect(g.name).toBe('Completely Invented Movement');
  });
});

describe('seed map', () => {
  it('ships around 40 pre-tagged exercises, none of them pre-confirmed', () => {
    expect(SEED_COUNT).toBeGreaterThanOrEqual(40);
    for (const [name, m] of Object.entries(SEED_META)) {
      expect(m.confirmed, name).toBe(false);
      expect(m.name).toBe(name);
    }
  });

  it('is an overlay, not a gate: an unseeded name still resolves', () => {
    expect(seedFor('Definitely Not Seeded')).toBeUndefined();
    expect(guessMeta('Definitely Not Seeded')).toBeTruthy();
  });
});

describe('alias resolution', () => {
  it('flattens a chain to its canonical end', () => {
    const idx = buildMetaIndex({
      A: meta('A', { aliasOf: 'B' }),
      B: meta('B', { aliasOf: 'C' }),
      C: meta('C'),
    });
    expect(idx.canonicalOf('A')).toBe('C');
    expect(idx.canonicalOf('B')).toBe('C');
    expect(idx.resolve('A').meta.name).toBe('C');
    expect(idx.issues).toEqual([]);
  });

  it('breaks a cycle deterministically instead of hanging', () => {
    const idx = buildMetaIndex({
      A: meta('A', { aliasOf: 'B' }),
      B: meta('B', { aliasOf: 'C' }),
      C: meta('C', { aliasOf: 'A' }),
    });
    expect(idx.canonicalOf('A')).toBe('A');
    expect(idx.issues.some((i) => i.kind === 'alias-cycle')).toBe(true);
  });

  it('reports a dangling alias without inventing the target', () => {
    const idx = buildMetaIndex({ A: meta('A', { aliasOf: 'Nope' }) });
    expect(idx.canonicalOf('A')).toBe('A');
    expect(idx.issues).toContainEqual({ kind: 'alias-dangling', name: 'A', target: 'Nope' });
    expect(idx.map['Nope']).toBeUndefined();
  });

  it('resolves an unknown name to an unconfirmed guess rather than undefined', () => {
    const idx = buildMetaIndex({});
    const r = idx.resolve('Brand New Exercise');
    expect(r.meta.confirmed).toBe(false);
    expect(r.canonical).toBe('Brand New Exercise');
  });
});
