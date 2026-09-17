import { describe, expect, it } from 'vitest';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta } from '../test/helpers';
import { records, recordsFor, recordsPerBucket } from './records';

const META = {
  'Squat (Barbell)': meta('Squat (Barbell)', { loadType: 'external' }),
  'Pull Up': meta('Pull Up', { loadType: 'bodyweight-plus' }),
};

function build(rows: Parameters<typeof makeCsv>[0], bw = [{ date: '2024-01-01', kg: 80 }]) {
  return enrich(parseCsv(makeCsv(rows)).sets, META, bw);
}

const D1 = '2024-03-04 18:00:00';
const D2 = '2024-03-11 18:00:00';
const D3 = '2024-03-18 18:00:00';

describe('records', () => {
  it('sets no records in an exercise\'s first session', () => {
    const sets = build([
      { date: D1, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { date: D1, exercise: 'Squat (Barbell)', setOrder: 2, weight: 110, reps: 3 },
    ]);
    expect(records(sets)).toEqual([]);
  });

  it('reports one record per kind per session, with what it beat', () => {
    const sets = build([
      { date: D1, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      // Two sets both beat the old load; only the heavier is the record.
      { date: D2, exercise: 'Squat (Barbell)', setOrder: 1, weight: 105, reps: 5 },
      { date: D2, exercise: 'Squat (Barbell)', setOrder: 2, weight: 110, reps: 3 },
    ]);
    const r = records(sets);
    const load = r.find((e) => e.kind === 'load');
    expect(load?.value).toBe(110);
    expect(load?.previous).toBe(100);
    // 105x5 is the better e1RM (122.5) against 110x3 (121).
    const e1rm = r.find((e) => e.kind === 'e1rm');
    expect(e1rm?.value).toBeCloseTo(122.5, 1);
    expect(e1rm?.previous).toBeCloseTo(116.7, 1);
    // No rep record: neither 105 nor 110 had been lifted before.
    expect(r.filter((e) => e.kind === 'reps-at-load')).toEqual([]);
    expect(r).toHaveLength(2);
  });

  it('counts more reps at a load already lifted as a rep record, and ties as nothing', () => {
    const sets = build([
      { date: D1, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { date: D2, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 }, // tie
      { date: D3, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 7 },
    ]);
    const r = records(sets);
    expect(r.filter((e) => e.date.getDate() === 11)).toEqual([]);
    const reps = r.find((e) => e.kind === 'reps-at-load');
    expect(reps?.value).toBe(7);
    expect(reps?.previous).toBe(5);
    expect(reps?.loadKg).toBe(100);
    // 100x7 is also a new e1RM (123.3 > 116.7).
    expect(r.find((e) => e.kind === 'e1rm')?.value).toBeCloseTo(123.3, 1);
  });

  it('ignores warm-ups and unloaded sets', () => {
    const sets = build([
      { date: D1, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { date: D2, exercise: 'Squat (Barbell)', setOrder: 'W', weight: 140, reps: 1 },
      { date: D2, exercise: 'Squat (Barbell)', setOrder: 1, weight: 0, reps: 5 },
    ]);
    expect(records(sets)).toEqual([]);
  });

  it('marks a bodyweight movement\'s load record as bodyweight-driven', () => {
    const sets = build(
      [
        { date: D1, exercise: 'Pull Up', setOrder: 1, weight: 0, reps: 8 },
        { date: D3, exercise: 'Pull Up', setOrder: 1, weight: 0, reps: 8 },
      ],
      // Two kilos heavier by the second session: same reps, more load.
      [
        { date: '2024-03-01', kg: 80 },
        { date: '2024-03-15', kg: 82 },
      ],
    );
    const r = records(sets);
    const load = r.find((e) => e.kind === 'load');
    expect(load?.value).toBe(82);
    expect(load?.bodyweightDriven).toBe(true);
    expect(load?.parts).toEqual({ loadType: 'bodyweight-plus', totalKg: 82, bodyweightKg: 82, addedKg: 0 });
  });

  it('filters by exercise and buckets by month including empty months', () => {
    const sets = build([
      { date: '2024-01-08 18:00:00', exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { date: '2024-01-15 18:00:00', exercise: 'Squat (Barbell)', setOrder: 1, weight: 105, reps: 5 },
      { date: '2024-03-15 18:00:00', exercise: 'Squat (Barbell)', setOrder: 1, weight: 110, reps: 5 },
    ]);
    const r = records(sets);
    expect(recordsFor(r, 'Squat (Barbell)')).toHaveLength(4);
    expect(recordsFor(r, 'Pull Up')).toEqual([]);
    const months = recordsPerBucket(r, { granularity: 'month' });
    expect(months.map((m) => m.count)).toEqual([2, 0, 2]);
    expect(months[0]?.byKind).toEqual({ e1rm: 1, load: 1, 'reps-at-load': 0 });
  });
});
