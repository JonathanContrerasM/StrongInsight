import { describe, expect, it } from 'vitest';
import { parseCsv } from '../ingest/parseCsv';
import { enrich, makeCsv, meta, type RowSpec } from '../test/helpers';
import type { ExerciseMeta } from '../model/types';
import {
  estimateRir,
  fatigueHistory,
  fatigueStimuli,
  groupReadiness,
  weeklyVolume,
  FATIGUE_LEVELS,
  fatigueLevelOf,
  fatigueStateOf,
  hoursUntilReady,
  isStale,
  muscleFatigue,
  muscleWeights,
  READY_BELOW,
  rirWeight,
  TRACKED_MUSCLES,
} from './recovery';

const META: Record<string, ExerciseMeta> = {
  'Bench Press (Barbell)': meta('Bench Press (Barbell)', {
    primaryMuscle: 'chest',
    secondaryMuscles: ['triceps', 'shoulders'],
  }),
  'Squat (Barbell)': meta('Squat (Barbell)', { primaryMuscle: 'quads', secondaryMuscles: ['glutes'] }),
  Plank: meta('Plank', { primaryMuscle: 'abs', loadType: 'duration' }),
  Burpee: meta('Burpee', { primaryMuscle: 'full-body', loadType: 'bodyweight' }),
  Guess: meta('Guess', { primaryMuscle: 'biceps', confirmed: false }),
};
const lookup = (n: string) => META[n];

const T0 = new Date(2024, 2, 4, 18, 0, 0);
const HOUR = 3_600_000;

function at(hoursAfterT0: number): Date {
  return new Date(T0.getTime() + hoursAfterT0 * HOUR);
}

function stamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':00'
  );
}

/** `n` sets of one exercise in one workout at `when`. */
function session(when: Date, exercise: string, n: number, extra: Partial<RowSpec> = {}): RowSpec[] {
  return Array.from({ length: n }, (_, i) => ({
    date: stamp(when),
    workout: 'W' + when.getTime(),
    exercise,
    setOrder: i + 1,
    weight: 100,
    reps: 5,
    rpe: '9',
    ...extra,
  }));
}

function enriched(rows: RowSpec[]) {
  return enrich(parseCsv(makeCsv(rows)).sets, META, [{ date: '2024-01-01', kg: 80 }]);
}

function run(rows: RowSpec[], asOf: Date) {
  const sets = enriched(rows);
  const r = muscleFatigue(sets, lookup, asOf);
  const of = (m: string) => r.muscles.find((x) => x.muscle === m)!;
  return { ...r, of };
}

describe('threshold table', () => {
  it('derives colour level and label from the same bands at every boundary', () => {
    for (const b of FATIGUE_LEVELS) {
      for (const v of [b.from, b.from + 1e-9]) {
        expect(fatigueLevelOf(v)).toBe(b.level);
        expect(fatigueStateOf(v)).toBe(b.state);
      }
      if (b.from > 0) {
        const below = FATIGUE_LEVELS[b.level - 1]!;
        expect(fatigueLevelOf(b.from - 1e-9)).toBe(below.level);
        expect(fatigueStateOf(b.from - 1e-9)).toBe(below.state);
      }
    }
  });

  it('starts "recovering" exactly where hoursUntilReady says ready ends', () => {
    expect(FATIGUE_LEVELS.find((b) => b.state === 'recovering')?.from).toBe(READY_BELOW);
  });
});

describe('muscleFatigue', () => {
  it('returns every tracked muscle at zero with no history', () => {
    const r = run([], T0);
    expect(r.muscles.map((m) => m.muscle)).toEqual([...TRACKED_MUSCLES]);
    for (const m of r.muscles) {
      expect(m.value).toBe(0);
      expect(m.state).toBe('ready');
      expect(m.lastTrained).toBeNull();
      expect(m.hoursToReady).toBe(0);
    }
  });

  it('weights the primary in full and secondaries at half', () => {
    const r = run(session(T0, 'Bench Press (Barbell)', 4), T0);
    // A first session has no baseline: gain (sets + 4) / 4, capped at 2.
    expect(r.of('chest').value).toBeCloseTo(1 - Math.exp(-(4 / 8) * 2), 9);
    expect(r.of('triceps').value).toBeCloseTo(1 - Math.exp(-(2 / 8) * 1.5), 9);
    expect(r.of('quads').value).toBe(0);
    expect(r.of('chest').hardSets7d).toBe(4);
    expect(r.of('triceps').hardSets7d).toBe(2);
  });

  it('halves the residue at one half-life (24 h for chest, 30 h for quads)', () => {
    const rows = [...session(T0, 'Bench Press (Barbell)', 4), ...session(T0, 'Squat (Barbell)', 4)];
    const x = (v: number) => -Math.log(1 - v);
    const now = run(rows, T0);
    expect(x(run(rows, at(24)).of('chest').value)).toBeCloseTo(x(now.of('chest').value) / 2, 9);
    expect(x(run(rows, at(30)).of('quads').value)).toBeCloseTo(x(now.of('quads').value) / 2, 9);
  });

  it('saturates below 1 and caps a session at 12 sets per muscle', () => {
    const twelve = run(session(T0, 'Bench Press (Barbell)', 12), T0).of('chest').value;
    const thirty = run(session(T0, 'Bench Press (Barbell)', 30), T0).of('chest').value;
    expect(thirty).toBe(twelve);
    expect(twelve).toBeLessThan(1);
    expect(run(session(T0, 'Bench Press (Barbell)', 12), T0).of('chest').state).toBe('fatigued');
  });

  it('counts an easy set (RPE 6) less than a hard one (RPE 9)', () => {
    const hard = run(session(T0, 'Bench Press (Barbell)', 4, { rpe: '9' }), T0).of('chest');
    const easy = run(session(T0, 'Bench Press (Barbell)', 4, { rpe: '6' }), T0).of('chest');
    expect(easy.value).toBeLessThan(hard.value);
    expect(easy.hardSets7d).toBeCloseTo(4 * (1 - 0.7 / 3), 9); // RIR 4
  });

  it('estimates effort from the recent best e1RM when no RPE was logged', () => {
    // Anchor: 100 kg x 5 two days earlier -> e1RM 116.7 kg.
    const anchor = session(at(-48), 'Bench Press (Barbell)', 1, { rpe: '' });
    // 60 kg x 5 against that is ~23 reps in reserve: the floor weight.
    const light = session(T0, 'Bench Press (Barbell)', 4, { weight: 60, rpe: '' });
    const r = run([...anchor, ...light], T0);
    expect(r.of('chest').hardSets7d).toBeCloseTo(1 + 4 * 0.3, 9);
  });

  it('counts warm-ups at 0.3 and timed holds as full sets', () => {
    const r = run(
      [
        ...session(T0, 'Bench Press (Barbell)', 3, { setOrder: 'W', rpe: '' }),
        ...session(T0, 'Plank', 2, { weight: 0, reps: 0, seconds: 60, rpe: '' }),
      ],
      T0,
    );
    expect(r.of('chest').hardSets7d).toBeCloseTo(0.9, 9);
    expect(r.of('abs').hardSets7d).toBe(2);
  });

  it('tires a lifter less when the volume is routine (acute:chronic gain)', () => {
    // Four weeks of 6 chest sets every Monday, then the same session again.
    const routine = [0, 1, 2, 3].flatMap((w) => session(at(-24 * 7 * (4 - w)), 'Bench Press (Barbell)', 6));
    const today = session(T0, 'Bench Press (Barbell)', 6);
    const habitual = run([...routine, ...today], T0).of('chest');
    const fresh = run(today, T0).of('chest');
    expect(habitual.value).toBeLessThan(fresh.value);
  });

  it('ignores sets after asOf and sessions outside the 30-day lookback', () => {
    const r = run(session(at(5), 'Bench Press (Barbell)', 6), T0);
    expect(r.of('chest').value).toBe(0);
    const old = run(session(at(-24 * 31), 'Bench Press (Barbell)', 6), T0).of('chest');
    expect(old.value).toBe(0);
    expect(old.lastTrained).toEqual(at(-24 * 31));
  });

  it('counts unmapped working sets and flags unconfirmed tags', () => {
    const r = run([...session(T0, 'Burpee', 3), ...session(T0, 'Guess', 2)], T0);
    expect(r.unmappedSets).toBe(3);
    expect(r.of('biceps').unconfirmed).toBe(true);
    expect(r.of('chest').unconfirmed).toBe(false);
  });

  it('predicts when a muscle is ready again', () => {
    const rows = session(T0, 'Bench Press (Barbell)', 8);
    const now = run(rows, T0).of('chest');
    expect(now.hoursToReady).toBeGreaterThan(0);
    const later = run(rows, at(now.hoursToReady + 0.01)).of('chest');
    expect(later.state).toBe('ready');
    const before = run(rows, at(now.hoursToReady - 0.5)).of('chest');
    expect(before.state).not.toBe('ready');
  });
});

describe('calibration', () => {
  /** The last session's gain: its stimulus over sets / 8. */
  const lastGain = (rows: RowSpec[], muscle: 'chest' | 'quads') => {
    const list = fatigueStimuli(enriched(rows), lookup).byMuscle.get(muscle)!;
    const last = list[list.length - 1]!;
    return last.stimulus / (last.sets / 8);
  };

  it('reads a same-weekday routine as routine even when it starts earlier each week', () => {
    // Six weekly sessions, each an hour earlier than the last: 6 d 23 h apart.
    const rows = [0, 1, 2, 3, 4, 5].flatMap((w) =>
      session(at(-(5 - w) * (7 * 24 - 1)), 'Bench Press (Barbell)', 6),
    );
    expect(lastGain(rows, 'chest')).toBeCloseTo(1, 9);
  });

  it('reads a twice-weekly split as routine', () => {
    const rows: RowSpec[] = [];
    for (let w = 0; w < 6; w++) {
      rows.push(...session(at(-(5 - w) * 168 - 72), 'Bench Press (Barbell)', 3));
      rows.push(...session(at(-(5 - w) * 168), 'Bench Press (Barbell)', 3));
    }
    expect(lastGain(rows, 'chest')).toBeCloseTo(1, 9);
  });

  it('has a routine hard leg day ready in two to three and a half days', () => {
    const rows = [0, 1, 2, 3, 4].flatMap((w) => session(at(-(4 - w) * 168), 'Squat (Barbell)', 12));
    const h = run(rows, T0).of('quads').hoursToReady;
    expect(h).toBeGreaterThan(48);
    expect(h).toBeLessThan(84);
  });
});

describe('groupReadiness', () => {
  it('waits on the most fatigued main mover', () => {
    const groups = groupReadiness(run(session(T0, 'Bench Press (Barbell)', 10), T0).muscles);
    const push = groups.find((g) => g.group === 'push')!;
    expect(push.state).toBe('fatigued');
    expect(push.limiting).toBe('chest');
    expect(groups.find((g) => g.group === 'legs')?.state).toBe('ready');
    expect(groups.map((g) => g.group)).toEqual(['push', 'pull', 'legs', 'core']);
  });
});

describe('weeklyVolume', () => {
  it('rates hard sets against the 10-20 band, trained muscles only', () => {
    const r = run(session(T0, 'Bench Press (Barbell)', 12), T0);
    const v = weeklyVolume(r.muscles, T0);
    expect(v.map((x) => [x.muscle, x.sets, x.status])).toEqual([
      ['chest', 12, 'in'],
      ['shoulders', 6, 'under'],
      ['triceps', 6, 'under'],
    ]);
  });
});

describe('fatigueHistory', () => {
  it('draws one value per day and counts training while still fatigued', () => {
    const rows = [...session(at(-24), 'Bench Press (Barbell)', 12), ...session(T0, 'Bench Press (Barbell)', 12)];
    const h = fatigueHistory(fatigueStimuli(enriched(rows), lookup), T0, 14);
    expect(h.days).toHaveLength(14);
    expect(h.days.at(-1)).toEqual(new Date(2024, 2, 4));
    const chest = h.rows.find((r) => r.muscle === 'chest')!;
    expect(chest.values).toHaveLength(14);
    expect(chest.trained.filter(Boolean)).toHaveLength(2);
    // The second day went in fatigued; the first could not have.
    expect(chest.overreached.slice(-2)).toEqual([false, true]);
    expect(chest.overreachCount).toBe(1);
    expect(h.whileFatigued).toBe(1);
    expect(h.muscleSessions).toBe(6); // chest, shoulders, triceps x 2 days
    expect(h.rows.map((r) => r.muscle)).toEqual(['chest', 'shoulders', 'triceps']);
  });

  it('is empty without training in the window', () => {
    const h = fatigueHistory(fatigueStimuli([], lookup), T0, 7);
    expect(h.rows).toEqual([]);
    expect(h.muscleSessions).toBe(0);
  });
});

describe('helpers', () => {
  it('maps RIR to effort weight', () => {
    expect(rirWeight(null)).toBe(1);
    expect(rirWeight(0)).toBe(1);
    expect(rirWeight(3)).toBe(1);
    expect(rirWeight(4.5)).toBeCloseTo(0.65, 9);
    expect(rirWeight(6)).toBe(0.3);
    expect(rirWeight(10)).toBe(0.3);
  });

  it('inverts Epley and clamps', () => {
    expect(estimateRir(100, 5, 100 * (1 + 8 / 30))).toBeCloseTo(3, 9);
    expect(estimateRir(120, 5, 100)).toBe(0);
    expect(estimateRir(10, 5, 200)).toBe(10);
    expect(estimateRir(100, 5, null)).toBeNull();
    expect(estimateRir(null, 5, 100)).toBeNull();
    expect(estimateRir(100, 0, 100)).toBeNull();
  });

  it('drops full-body and unknown, and keeps the larger weight on a repeat', () => {
    const w = muscleWeights('chest', ['chest', 'triceps', 'full-body', 'unknown']);
    expect([...w]).toEqual([
      ['chest', 1],
      ['triceps', 0.5],
    ]);
  });

  it('solves the ready time in closed form', () => {
    expect(hoursUntilReady(0, 30)).toBe(0);
    const limit = -Math.log(1 - READY_BELOW);
    expect(hoursUntilReady(limit * 4, 30)).toBeCloseTo(60, 9);
  });

  it('calls an export stale after a week', () => {
    expect(isStale(T0, at(24 * 7))).toBe(false);
    expect(isStale(T0, at(24 * 7 + 1))).toBe(true);
  });
});
