import { describe, it, expect } from 'vitest';
import { brzycki, e1rm, epley, setCounts, summarise, volume } from './index';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta } from '../test/helpers';

const BW = [{ date: '2024-01-01', kg: 80 }];

describe('e1rm', () => {
  it('returns the weight itself for a single', () => {
    expect(epley(100, 1)).toBe(100);
    expect(brzycki(100, 1)).toBe(100);
  });

  it('agrees with itself at the classic anchor of 100kg x 10', () => {
    expect(epley(100, 10)).toBeCloseTo(133.333, 3);
    expect(brzycki(100, 10)).toBeCloseTo(133.333, 3);
  });

  it('refuses beyond the rep cap, where both formulas become fiction', () => {
    const csv = makeCsv([{ exercise: 'Squat (Barbell)', setOrder: 1, weight: 60, reps: 20 }]);
    const sets = enrich(parseCsv(csv).sets, { 'Squat (Barbell)': meta('Squat (Barbell)') });
    expect(e1rm(sets[0]!)).toBeNull();
  });

  it('refuses unloaded and unquantifiable sets', () => {
    const csv = makeCsv([
      { exercise: 'Squat (Barbell)', setOrder: 1, weight: 0, reps: 10 },
      { exercise: 'Plank', setOrder: 2, weight: 0, reps: 0, seconds: 60 },
    ]);
    const sets = enrich(
      parseCsv(csv).sets,
      {
        'Squat (Barbell)': meta('Squat (Barbell)', { loadType: 'external' }),
        Plank: meta('Plank', { loadType: 'duration' }),
      },
      BW,
    );
    expect(e1rm(sets[0]!)).toBeNull();
    expect(e1rm(sets[1]!)).toBeNull();
  });

  it('computes from EFFECTIVE load, so a bodyweight set is not invisible', () => {
    const csv = makeCsv([{ exercise: 'Pull Up', setOrder: 1, weight: 0, reps: 5 }]);
    const sets = enrich(parseCsv(csv).sets, { 'Pull Up': meta('Pull Up', { loadType: 'bodyweight-plus' }) }, BW);
    expect(e1rm(sets[0]!)).toBeCloseTo(epley(80, 5), 6);
  });
});

describe('volume', () => {
  it('sums effective load times reps', () => {
    const csv = makeCsv([
      { exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { exercise: 'Squat (Barbell)', setOrder: 2, weight: 100, reps: 5 },
    ]);
    const sets = enrich(parseCsv(csv).sets, { 'Squat (Barbell)': meta('Squat (Barbell)') });
    const v = volume(sets);
    expect(v.volumeKg).toBe(1000);
    expect(v.includedSets).toBe(2);
    expect(v.excludedSets).toBe(0);
  });

  it('counts an empty-bar set but excludes it from volume, and says why', () => {
    const csv = makeCsv([
      { exercise: 'Squat (Barbell)', setOrder: 1, weight: 0, reps: 8 },
      { exercise: 'Squat (Barbell)', setOrder: 2, weight: 100, reps: 5 },
    ]);
    const sets = enrich(parseCsv(csv).sets, { 'Squat (Barbell)': meta('Squat (Barbell)') });
    expect(sets[0]?.isUnloaded).toBe(true);
    expect(sets[1]?.isUnloaded).toBe(false);

    const v = volume(sets);
    expect(v.volumeKg).toBe(500);
    expect(v.excludedUnloaded).toBe(1);
    expect(setCounts(sets).total).toBe(2);
    expect(setCounts(sets).unloaded).toBe(1);
  });

  it('excludes duration work from volume without discarding the set', () => {
    const csv = makeCsv([{ exercise: 'Plank', setOrder: 1, weight: 0, reps: 0, seconds: 60 }]);
    const sets = enrich(parseCsv(csv).sets, { Plank: meta('Plank', { loadType: 'duration' }) }, BW);
    const v = volume(sets);
    expect(v.volumeKg).toBe(0);
    expect(v.excludedNoLoad).toBe(1);
    expect(setCounts(sets).total).toBe(1);
    expect(sets[0]?.seconds).toBe(60);
  });

  it('excludes a set logged with load but zero reps', () => {
    const csv = makeCsv([{ exercise: 'Pull Up', setOrder: 1, weight: 40, reps: 0 }]);
    const sets = enrich(parseCsv(csv).sets, { 'Pull Up': meta('Pull Up', { loadType: 'bodyweight-plus' }) }, BW);
    const v = volume(sets);
    expect(v.volumeKg).toBe(0);
    expect(v.excludedNoReps).toBe(1);
  });

  /** The central design constraint: 31% of this corpus is bodyweight work. */
  it('gives both bodyweight AND added-load pull ups real volume', () => {
    const csv = makeCsv([
      { exercise: 'Pull Up', setOrder: 1, weight: 0, reps: 10 },
      { exercise: 'Pull Up', setOrder: 2, weight: 20, reps: 5 },
    ]);
    const sets = enrich(parseCsv(csv).sets, { 'Pull Up': meta('Pull Up', { loadType: 'bodyweight-plus' }) }, BW);

    expect(sets[0]?.effectiveLoadKg).toBe(80);
    expect(sets[1]?.effectiveLoadKg).toBe(100);

    const bodyweightOnly = volume([sets[0]!]);
    const weighted = volume([sets[1]!]);
    expect(bodyweightOnly.volumeKg).toBe(800);
    expect(weighted.volumeKg).toBe(500);
    expect(volume(sets).volumeKg).toBe(1300);
  });

  it('treats weight as absolute for external work and additive for bodyweight-plus', () => {
    const csv = makeCsv([{ exercise: 'X', setOrder: 1, weight: 20, reps: 10 }]);
    const parsed = parseCsv(csv).sets;
    expect(volume(enrich(parsed, { X: meta('X', { loadType: 'external' }) }, BW)).volumeKg).toBe(200);
    expect(volume(enrich(parsed, { X: meta('X', { loadType: 'bodyweight-plus' }) }, BW)).volumeKg).toBe(1000);
    expect(volume(enrich(parsed, { X: meta('X', { loadType: 'assisted' }) }, BW)).volumeKg).toBe(600);
    expect(volume(enrich(parsed, { X: meta('X', { loadType: 'bodyweight' }) }, BW)).volumeKg).toBe(800);
  });
});

describe('grouping', () => {
  it('merges an aliased rename into one history', () => {
    const csv = makeCsv([
      { exercise: 'Bench Press (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { exercise: 'Benchpress', setOrder: 1, weight: 100, reps: 5 },
    ]);
    const sets = enrich(parseCsv(csv).sets, {
      'Bench Press (Barbell)': meta('Bench Press (Barbell)'),
      Benchpress: meta('Benchpress', { aliasOf: 'Bench Press (Barbell)' }),
    });
    expect(new Set(sets.map((s) => s.canonicalName))).toEqual(new Set(['Bench Press (Barbell)']));
    expect(summarise('Bench Press (Barbell)', sets).counts.total).toBe(2);
  });
});
