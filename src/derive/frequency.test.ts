import { describe, expect, it } from 'vitest';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta, type RowSpec } from '../test/helpers';
import type { ExerciseMeta } from '../model/types';
import { muscleFrequency } from './frequency';

const META: Record<string, ExerciseMeta> = {
  'Bench Press (Barbell)': meta('Bench Press (Barbell)', { pattern: 'horiz-push', primaryMuscle: 'chest' }),
  'Pull Up': meta('Pull Up', { pattern: 'vert-pull', primaryMuscle: 'lats', loadType: 'bodyweight' }),
  'Squat (Barbell)': meta('Squat (Barbell)', { pattern: 'squat', primaryMuscle: 'quads' }),
  'Bicep Curl (Barbell)': meta('Bicep Curl (Barbell)', { pattern: 'isolation', primaryMuscle: 'biceps' }),
};
const lookup = (n: string) => META[n];

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' 18:00:00';
}

/** A push / pull / legs rotation, one exercise a day, every `step` days from a Monday. */
function rotation(sessions: number, step: number): RowSpec[] {
  const names = ['Bench Press (Barbell)', 'Pull Up', 'Squat (Barbell)'];
  const rows: RowSpec[] = [];
  for (let i = 0; i < sessions; i++) {
    const d = new Date(2024, 0, 1 + i * step);
    for (let s = 1; s <= 3; s++) {
      rows.push({ date: iso(d), workout: 'W' + i, exercise: names[i % 3] as string, setOrder: s, weight: 50, reps: 8 });
    }
  }
  return rows;
}

function freq(rows: RowSpec[]) {
  return muscleFrequency(enrich(parseCsv(makeCsv(rows)).sets, META), lookup, 1);
}

describe('muscleFrequency', () => {
  it('always returns the four groups in fixed order, zeros included', () => {
    const f = freq(rotation(3, 2));
    expect(f.map((g) => g.group)).toEqual(['push', 'pull', 'legs', 'core']);
    expect(f[3]?.sessions).toBe(0);
    expect(f[3]?.daysSince).toBeNull();
    expect(f[3]?.medianGapDays).toBeNull();
  });

  it('counts sessions per calendar week and the median gap between them', () => {
    // 21 sessions every second day: Jan 1 to Feb 10 2024 spans six Monday-weeks.
    const f = freq(rotation(21, 2));
    for (const g of f.slice(0, 3)) {
      expect(g.sessions).toBe(7);
      expect(g.sessionsPerWeek).toBeCloseTo(7 / 6, 6);
      expect(g.medianGapDays).toBe(6);
      expect(g.sets).toBe(21);
    }
  });

  it('measures days since to the last session in the corpus, not to today', () => {
    const f = freq(rotation(4, 2)); // push, pull, legs, push on days 0, 2, 4, 6
    expect(f[0]?.daysSince).toBe(0); // push: last session IS the corpus's last
    expect(f[1]?.daysSince).toBe(4);
    expect(f[2]?.daysSince).toBe(2);
  });

  it('counts any working set as training the group, not only a dominant one', () => {
    // A leg day with one set of curls: pull was trained that day, for frequency.
    const rows = rotation(1, 2).map((r) => ({ ...r, exercise: 'Squat (Barbell)' }));
    rows.push({ ...rows[0]!, exercise: 'Bicep Curl (Barbell)', setOrder: 1 });
    const f = freq(rows);
    expect(f[2]?.sessions).toBe(1);
    expect(f[1]?.sessions).toBe(1);
    expect(f[1]?.sets).toBe(1);
  });

  it('ignores warm-ups', () => {
    const rows = rotation(1, 2).map((r) => ({ ...r, exercise: 'Squat (Barbell)' }));
    rows.push({ ...rows[0]!, exercise: 'Pull Up', setOrder: 'W' });
    const f = freq(rows);
    expect(f[1]?.sessions).toBe(0);
  });

  it('is all zeros on an empty corpus', () => {
    for (const g of muscleFrequency([], lookup, 1)) {
      expect(g.sessions).toBe(0);
      expect(g.sessionsPerWeek).toBe(0);
    }
  });
});
