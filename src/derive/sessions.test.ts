import { describe, expect, it } from 'vitest';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta } from '../test/helpers';
import { sessionDetail, sessionSummaries } from './sessions';

const META = {
  'Squat (Barbell)': meta('Squat (Barbell)', { loadType: 'external', pattern: 'squat' }),
  'Bench Press (Barbell)': meta('Bench Press (Barbell)', { loadType: 'external', pattern: 'horiz-push' }),
  'Pull Up': meta('Pull Up', { loadType: 'bodyweight-plus', pattern: 'vert-pull' }),
};
const lookup = (n: string) => META[n as keyof typeof META];
const BW = [{ date: '2024-01-01', kg: 80 }];

function build(rows: Parameters<typeof makeCsv>[0]) {
  const parsed = parseCsv(makeCsv(rows));
  return { sets: enrich(parsed.sets, META, BW), workouts: parsed.workouts };
}

const MONDAY = '2024-03-04 18:00:00';
const WEDNESDAY = '2024-03-06 18:00:00';

describe('sessionSummaries', () => {
  it("lists one row per workout, newest first, with Strong's label and the duration", () => {
    const { sets, workouts } = build([
      { date: MONDAY, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5, duration: '1h 5min' },
      { date: MONDAY, exercise: 'Squat (Barbell)', setOrder: 2, weight: 100, reps: 5, duration: '1h 5min' },
      {
        date: WEDNESDAY,
        exercise: 'Bench Press (Barbell)',
        setOrder: 1,
        weight: 60,
        reps: 8,
        workout: 'Morgen-Workout',
        duration: '45min',
      },
    ]);
    const rows = sessionSummaries(sets, workouts, lookup);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.name).toBe('Morgen-Workout');
    expect(rows[0]?.durationSec).toBe(45 * 60);
    expect(rows[0]?.setCount).toBe(1);
    expect(rows[1]?.setCount).toBe(2);
    expect(rows[1]?.exercises).toEqual(['Squat (Barbell)']);
    expect(rows[1]?.volume.volumeKg).toBe(1000);
    expect(rows[1]?.focus.label).toBe('Legs');
    expect(rows[0]?.focus.label).toBe('Push');
  });

  it('counts working sets separately from warm-ups and drop sets', () => {
    const { sets, workouts } = build([
      { date: MONDAY, exercise: 'Squat (Barbell)', setOrder: 'W', weight: 40, reps: 5 },
      { date: MONDAY, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { date: MONDAY, exercise: 'Squat (Barbell)', setOrder: 'D', weight: 80, reps: 5 },
    ]);
    const [row] = sessionSummaries(sets, workouts, lookup);
    expect(row?.setCount).toBe(3);
    expect(row?.workingSets).toBe(1);
  });

  it('is empty on an empty corpus', () => {
    expect(sessionSummaries([], [], lookup)).toEqual([]);
  });
});

describe('sessionDetail', () => {
  it('keeps exercises in the order they were performed, and sets in setOrder within each', () => {
    const { sets, workouts } = build([
      // Strong writes every set of an exercise together, in performance order.
      { date: MONDAY, exercise: 'Bench Press (Barbell)', setOrder: 1, weight: 60, reps: 8 },
      { date: MONDAY, exercise: 'Bench Press (Barbell)', setOrder: 2, weight: 65, reps: 6 },
      { date: MONDAY, exercise: 'Pull Up', setOrder: 1, weight: 0, reps: 10 },
      { date: MONDAY, exercise: 'Pull Up', setOrder: 2, weight: 5, reps: 8 },
    ]);
    const id = workouts[0]?.id as string;
    const d = sessionDetail(sets, workouts, id, lookup);
    expect(d).not.toBeNull();
    expect(d?.blocks.map((b) => b.name)).toEqual(['Bench Press (Barbell)', 'Pull Up']);
    expect(d?.blocks[0]?.sets.map((s) => s.setOrder)).toEqual([1, 2]);
    // The bodyweight movement resolves through the resolver: bodyweight plus the belt.
    expect(d?.blocks[1]?.sets[1]?.effectiveLoadKg).toBe(85);
    expect(d?.blocks[1]?.sets[1]?.bodyweightKg).toBe(80);
    // A barbell set carries no bodyweight, so it cannot be read as load.
    expect(d?.blocks[0]?.sets[0]?.bodyweightKg).toBeNull();
    expect(d?.exerciseCount).toBe(2);
    expect(d?.focus.label).toBe('Push / Pull');
  });

  it('returns null for an id that is not in the corpus', () => {
    const { sets, workouts } = build([
      { date: MONDAY, exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
    ]);
    expect(sessionDetail(sets, workouts, 'nope', lookup)).toBeNull();
  });
});
