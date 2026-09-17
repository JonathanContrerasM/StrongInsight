import { describe, expect, it } from 'vitest';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta, type RowSpec } from '../test/helpers';
import type { ExerciseMeta } from '../model/types';
import { focusGroupOf, sessionFocus } from './focus';

const META: Record<string, ExerciseMeta> = {
  'Bench Press (Barbell)': meta('Bench Press (Barbell)', { pattern: 'horiz-push', primaryMuscle: 'chest' }),
  'Overhead Press (Barbell)': meta('Overhead Press (Barbell)', { pattern: 'vert-push', primaryMuscle: 'shoulders' }),
  'Pull Up': meta('Pull Up', { pattern: 'vert-pull', primaryMuscle: 'lats', loadType: 'bodyweight' }),
  'Seated Row (Cable)': meta('Seated Row (Cable)', { pattern: 'horiz-pull', primaryMuscle: 'back' }),
  'Bicep Curl (Barbell)': meta('Bicep Curl (Barbell)', { pattern: 'isolation', primaryMuscle: 'biceps' }),
  'Leg Extension (Machine)': meta('Leg Extension (Machine)', { pattern: 'isolation', primaryMuscle: 'quads' }),
  'Squat (Barbell)': meta('Squat (Barbell)', { pattern: 'squat', primaryMuscle: 'quads' }),
  'Standing Calf Raise (Bodyweight)': meta('Standing Calf Raise (Bodyweight)', {
    pattern: 'isolation',
    primaryMuscle: 'calves',
    loadType: 'bodyweight',
  }),
  Plank: meta('Plank', { pattern: 'core', primaryMuscle: 'abs', loadType: 'duration' }),
  'Farmer Walk': meta('Farmer Walk', { pattern: 'carry', primaryMuscle: 'full-body' }),
  Mystery: meta('Mystery', { pattern: 'unknown', primaryMuscle: 'unknown', confirmed: false }),
};

const lookup = (n: string) => META[n];
const D = '2024-03-04 18:00:00';

/** `n` working sets of `exercise`, plus optional warm-ups, all in one session. */
function block(exercise: string, n: number, warmups = 0): RowSpec[] {
  const rows: RowSpec[] = [];
  for (let w = 0; w < warmups; w++) rows.push({ date: D, exercise, setOrder: 'W', weight: 20, reps: 10 });
  for (let i = 1; i <= n; i++) rows.push({ date: D, exercise, setOrder: i, weight: 50, reps: 8 });
  return rows;
}

function focus(rows: RowSpec[]) {
  return sessionFocus(enrich(parseCsv(makeCsv(rows)).sets, META), lookup);
}

describe('focusGroupOf', () => {
  it('reads the pattern first', () => {
    expect(focusGroupOf(META['Bench Press (Barbell)'])).toBe('push');
    expect(focusGroupOf(META['Pull Up'])).toBe('pull');
    expect(focusGroupOf(META['Squat (Barbell)'])).toBe('legs');
    expect(focusGroupOf(META['Plank'])).toBe('core');
  });

  it('falls through to the muscle for isolation and carry work', () => {
    expect(focusGroupOf(META['Bicep Curl (Barbell)'])).toBe('pull');
    expect(focusGroupOf(META['Leg Extension (Machine)'])).toBe('legs');
    expect(focusGroupOf(META['Standing Calf Raise (Bodyweight)'])).toBe('legs');
    // full-body carries and unknown muscles assign nowhere.
    expect(focusGroupOf(META['Farmer Walk'])).toBeNull();
    expect(focusGroupOf(META['Mystery'])).toBeNull();
    expect(focusGroupOf(undefined)).toBeNull();
  });
});

describe('sessionFocus', () => {
  it('tags a push-and-pull session as both, and not as legs for one accessory', () => {
    // THE case: 8 push, 9 pull, and one bodyweight calf exercise of 3 sets.
    const f = focus([
      ...block('Bench Press (Barbell)', 4),
      ...block('Overhead Press (Barbell)', 4),
      ...block('Pull Up', 4),
      ...block('Seated Row (Cable)', 3),
      ...block('Bicep Curl (Barbell)', 2),
      ...block('Standing Calf Raise (Bodyweight)', 3),
    ]);
    expect(f.tags.map((t) => t.group)).toEqual(['pull', 'push']);
    expect(f.label).toBe('Pull / Push');
    expect(f.bySets.legs).toBe(3);
    expect(f.total).toBe(20);
  });

  it('gives one tag to a session that is one thing', () => {
    const f = focus([...block('Squat (Barbell)', 5), ...block('Leg Extension (Machine)', 3)]);
    expect(f.label).toBe('Legs');
    expect(f.tags).toHaveLength(1);
    expect(f.tags[0]?.share).toBe(1);
  });

  it('calls push, pull and legs together a full-body session', () => {
    const f = focus([
      ...block('Bench Press (Barbell)', 3),
      ...block('Seated Row (Cable)', 3),
      ...block('Squat (Barbell)', 3),
      ...block('Plank', 1),
    ]);
    expect(f.label).toBe('Full body');
    expect(f.tags.map((t) => t.group)).toEqual(['push', 'pull', 'legs']);
  });

  it('excludes warm-ups and counts only working sets', () => {
    const f = focus([...block('Bench Press (Barbell)', 3, 2), ...block('Squat (Barbell)', 1, 2)]);
    expect(f.total).toBe(4);
    expect(f.bySets.push).toBe(3);
    // 1 of 4 is 25%: over the bar, so it tags.
    expect(f.label).toBe('Push / Legs');
  });

  it('counts unassigned and unconfirmed sets without letting them tag', () => {
    const f = focus([...block('Bench Press (Barbell)', 3), ...block('Farmer Walk', 2), ...block('Mystery', 2)]);
    expect(f.unassigned).toBe(4);
    expect(f.unconfirmed).toBe(2);
    expect(f.label).toBe('Push');
  });

  it('breaks a tie in the fixed group order, whatever the input order', () => {
    const a = focus([...block('Seated Row (Cable)', 3), ...block('Bench Press (Barbell)', 3)]);
    const b = focus([...block('Bench Press (Barbell)', 3), ...block('Seated Row (Cable)', 3)]);
    expect(a.label).toBe('Push / Pull');
    expect(b.label).toBe('Push / Pull');
  });

  it('is Unknown with nothing assignable, and Unknown on an empty session', () => {
    expect(focus(block('Farmer Walk', 3)).label).toBe('Unknown');
    expect(sessionFocus([], lookup).label).toBe('Unknown');
  });
});
