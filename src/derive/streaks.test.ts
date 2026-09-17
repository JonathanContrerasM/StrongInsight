import { describe, expect, it } from 'vitest';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta, type RowSpec } from '../test/helpers';
import { streaks } from './streaks';

const META = { 'Squat (Barbell)': meta('Squat (Barbell)') };

function iso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' 18:00:00';
}

/** `pattern[i]` sessions in week i, on Monday, Wednesday, Friday..., from Monday 2024-01-01. */
function weeks(pattern: number[]): RowSpec[] {
  const rows: RowSpec[] = [];
  pattern.forEach((n, w) => {
    for (let s = 0; s < n; s++) {
      const d = new Date(2024, 0, 1 + w * 7 + s * 2);
      rows.push({ date: iso(d), workout: 'W' + w + '-' + s, exercise: 'Squat (Barbell)', weight: 100, reps: 5 });
    }
  });
  return rows;
}

function run(pattern: number[]) {
  return streaks(enrich(parseCsv(makeCsv(pattern.length ? weeks(pattern) : [])).sets, META), 1);
}

describe('streaks', () => {
  it('finds the current and the longest run of weeks with enough sessions', () => {
    // 8 trained, 4 rest (still weeks, they just have no sessions), then 3 trained.
    // Rest weeks need a placeholder so bucketBy spans them: one session < 2 is untrained.
    const r = run([3, 3, 2, 2, 3, 3, 2, 2, 1, 0, 0, 1, 2, 3, 2]);
    expect(r.longest).toBe(8);
    expect(r.longestFrom).toEqual(new Date(2024, 0, 1));
    expect(r.current).toBe(3);
    expect(r.currentFrom).toEqual(new Date(2024, 0, 1 + 12 * 7));
    expect(r.weeks).toBe(15);
  });

  it('does not let a trailing partial week break the streak', () => {
    // Three full weeks, then one session on the Monday of week four: the corpus
    // ends a day into that week. Current stays 3, and the week is flagged.
    const r = run([2, 2, 2, 1]);
    expect(r.current).toBe(3);
    expect(r.trailingPartial).toBe(true);
  });

  it('counts a trailing partial week that already qualifies', () => {
    // Monday and Wednesday of the last week: two sessions, the week counts.
    const r = run([2, 2, 2, 2]);
    expect(r.current).toBe(4);
    expect(r.trailingPartial).toBe(false);
  });

  it('is zero on an empty corpus and when nothing reaches the bar', () => {
    expect(run([]).current).toBe(0);
    const r = run([1, 1, 1]);
    expect(r.current).toBe(0);
    expect(r.longest).toBe(0);
    expect(r.longestFrom).toBeNull();
  });
});
