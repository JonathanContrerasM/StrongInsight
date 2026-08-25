import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../ingest/parseCsv';
import { guessMeta } from '../meta/guessMeta';
import { enrich, makeCsv, type RowSpec } from '../test/helpers';
import { REAL_FIXTURE, hasRealFixture } from '../test/fixtures';
import type { ExerciseMeta } from '../model/types';
import type { EnrichedSet } from '../model/effectiveLoad';
import { compareCorpora, type Corpus } from './compare';

/**
 * The tests that matter here are the ones asserting a comparison is REFUSED.
 * Almost anything can be divided by anything else and rendered as a ratio; the
 * work is knowing which ratios mean something.
 */

function corpusOf(rows: RowSpec[], label: string, bodyweightKg: number | null): Corpus {
  const { sets } = parseCsv(makeCsv(rows));
  const meta: Record<string, ExerciseMeta> = {};
  for (const n of [...new Set(sets.map((s) => s.exerciseName))]) meta[n] = guessMeta(n);
  return {
    label,
    sets: enrich(sets, meta, [], bodyweightKg ?? 80),
    meta: (n: string) => meta[n],
    bodyweightKg,
  };
}

/** `count` weekly sessions of one lift at a fixed load. */
function lift(
  exercise: string,
  count: number,
  weight: number | ((i: number) => number),
  reps = 5,
  startDay = 1,
): RowSpec[] {
  const out: RowSpec[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(2024, 0, startDay + i * 7);
    out.push({
      date:
        d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
        '-' + String(d.getDate()).padStart(2, '0') + ' 18:00:00',
      workout: exercise + i,
      exercise,
      weight: typeof weight === 'function' ? weight(i) : weight,
      reps,
    });
  }
  return out;
}

const nameOf = (c: { lifts: Array<{ name: string }> }) => c.lifts.map((l) => l.name);
const reasonFor = (c: { excluded: Array<{ name: string; reason: string }> }, n: string) =>
  c.excluded.find((e) => e.name === n)?.reason;

describe('matching', () => {
  it('pairs lifts by name and reports what only one side does', () => {
    const a = corpusOf([...lift('Squat (Barbell)', 8, 100), ...lift('Deadlift (Barbell)', 8, 140)], 'A', 80);
    const b = corpusOf([...lift('Squat (Barbell)', 8, 100), ...lift('Lunge (Dumbbell)', 8, 20)], 'B', 80);
    const c = compareCorpora(a, b);

    expect(c.sharedNames).toEqual(['Squat (Barbell)']);
    expect(c.yoursOnly).toEqual(['Deadlift (Barbell)']);
    expect(c.theirsOnly).toEqual(['Lunge (Dumbbell)']);
  });

  it('matches across casing and punctuation differences', () => {
    const a = corpusOf(lift('Bench Press (Barbell)', 8, 100), 'A', 80);
    const b = corpusOf(lift('bench-press (barbell)', 8, 100), 'B', 80);
    expect(compareCorpora(a, b).sharedNames).toHaveLength(1);
  });

  /** Guessing that two differently-named movements are the same is worse than saying so. */
  it('never fuzzily pairs two different movements', () => {
    const a = corpusOf(lift('Bench Press (Barbell)', 8, 100), 'A', 80);
    const b = corpusOf(lift('Incline Bench Press (Barbell)', 8, 80), 'B', 80);
    const c = compareCorpora(a, b);
    expect(c.sharedNames).toEqual([]);
    expect(c.yoursOnly).toEqual(['Bench Press (Barbell)']);
    expect(c.theirsOnly).toEqual(['Incline Bench Press (Barbell)']);
  });
});

describe('what gets refused', () => {
  /**
   * The refusal this feature exists for. 126 kg on one manufacturer's stack is
   * not 126 kg on another's, and a cable's label depends on the pulley ratio.
   */
  it('excludes machine and cable lifts, because a stack label is not a unit of force', () => {
    const rows = [
      ...lift('Squat (Barbell)', 8, 100),
      ...lift('Leg Extension (Machine)', 8, 60),
      ...lift('Seated Row (Cable)', 8, 70),
    ];
    const c = compareCorpora(corpusOf(rows, 'A', 80), corpusOf(rows, 'B', 80));

    expect(nameOf(c)).toEqual(['Squat (Barbell)']);
    expect(reasonFor(c, 'Leg Extension (Machine)')).toBe('machine-or-cable');
    expect(reasonFor(c, 'Seated Row (Cable)')).toBe('machine-or-cable');
  });

  it('excludes bodyweight work until both bodyweights are known', () => {
    const rows = [...lift('Squat (Barbell)', 8, 100), ...lift('Pull Up', 8, 0, 8)];

    const without = compareCorpora(corpusOf(rows, 'A', 80), corpusOf(rows, 'B', null));
    expect(without.bodyweightKnown).toBe(false);
    expect(reasonFor(without, 'Pull Up')).toBe('needs-bodyweight');

    const with_ = compareCorpora(corpusOf(rows, 'A', 80), corpusOf(rows, 'B', 90));
    expect(with_.bodyweightKnown).toBe(true);
    expect(nameOf(with_)).toContain('Pull Up');
  });

  it('excludes a lift without enough history on both sides', () => {
    const a = corpusOf(lift('Squat (Barbell)', 8, 100), 'A', 80);
    const b = corpusOf(lift('Squat (Barbell)', 2, 100), 'B', 80);
    const c = compareCorpora(a, b);
    expect(nameOf(c)).toEqual([]);
    expect(reasonFor(c, 'Squat (Barbell)')).toBe('not-enough-history');
  });
});

describe('strength', () => {
  it('reads level when two corpora are identical', () => {
    const rows = lift('Squat (Barbell)', 10, 100);
    const c = compareCorpora(corpusOf(rows, 'A', 80), corpusOf(rows, 'B', 80));
    expect(c.lifts[0]?.ratio).toBeCloseTo(1, 10);
    expect(c.lifts[0]?.youKg).toBeCloseTo(c.lifts[0]?.themKg as number, 10);
  });

  /**
   * THE regression test. A max is biased by how many attempts were logged, so a
   * longer history wins on PRs without being stronger. The headline number must
   * not move; the peak is expected to.
   */
  it('does not let a longer history win on the headline number', () => {
    // Same lifter, same weights, drawn from the same distribution -- one just
    // logged four times as many sessions.
    const pattern = (i: number) => 100 + (i % 5) * 5;
    const short = corpusOf(lift('Squat (Barbell)', 10, pattern), 'A', 80);
    const long = corpusOf(lift('Squat (Barbell)', 40, pattern), 'B', 80);
    const c = compareCorpora(short, long);
    const row = c.lifts[0];

    expect(row).toBeDefined();
    // The median session best is the same distribution either way.
    expect(row!.ratio).toBeGreaterThan(0.95);
    expect(row!.ratio).toBeLessThan(1.05);
    // And the attempt counts are carried so the peak can be read in context.
    expect(row!.themSessions).toBeGreaterThan(row!.youSessions * 3);
  });

  it('divides through by bodyweight when asked to', () => {
    const rows = lift('Squat (Barbell)', 10, 100);
    // Identical lifting, but one lifter is much heavier.
    const c = compareCorpora(corpusOf(rows, 'A', 70), corpusOf(rows, 'B', 140));
    expect(c.lifts[0]?.ratio).toBeCloseTo(1, 10);
    // Same absolute load at double the bodyweight is half the relative strength.
    expect(c.lifts[0]?.relativeRatio).toBeCloseTo(0.5, 10);
  });

  it('leaves relative strength null when a bodyweight is missing', () => {
    const rows = lift('Squat (Barbell)', 10, 100);
    const c = compareCorpora(corpusOf(rows, 'A', null), corpusOf(rows, 'B', 80));
    expect(c.lifts[0]?.relativeRatio).toBeNull();
  });
});

describe('progression', () => {
  it('reports kg per month for both sides', () => {
    const a = corpusOf(lift('Squat (Barbell)', 15, (i) => 100 + i), 'A', 80);
    const b = corpusOf(lift('Squat (Barbell)', 15, (i) => 100 + i * 2), 'B', 80);
    const s = compareCorpora(a, b).slopes[0];
    expect(s?.themKgPerMonth).toBeGreaterThan(s?.youKgPerMonth as number);
    expect(s?.youKgPerMonth).toBeGreaterThan(0);
  });

  it('says nothing about a lift with too short a history to fit', () => {
    const rows = lift('Squat (Barbell)', 4, (i) => 100 + i);
    expect(compareCorpora(corpusOf(rows, 'A', 80), corpusOf(rows, 'B', 80)).slopes).toEqual([]);
  });
});

describe('training shape', () => {
  it('compares rates, so a longer history does not simply win', () => {
    // Same weekly habit, one twice as long.
    const a = corpusOf(lift('Squat (Barbell)', 10, 100), 'A', 80);
    const b = corpusOf(lift('Squat (Barbell)', 20, 100), 'B', 80);
    const c = compareCorpora(a, b);
    // Both are training weekly. They do not land on exactly 1.0 because a weekly
    // cadence over N weeks spans (N-1)*7+1 days, an edge effect that shrinks as
    // the history grows -- but the rates stay close where the totals do not.
    expect(c.you.sessionsPerWeek).toBeGreaterThan(0.95);
    expect(c.you.sessionsPerWeek).toBeLessThan(1.15);
    expect(c.them.sessionsPerWeek).toBeGreaterThan(0.95);
    expect(c.them.sessionsPerWeek).toBeLessThan(1.15);
    // ...even though the totals differ by design.
    expect(c.them.sessions).toBe(20);
    expect(c.you.sessions).toBe(10);
  });

  it('surfaces habits they have and you do not', () => {
    const a = corpusOf(lift('Squat (Barbell)', 8, 100), 'A', 80);
    const b = corpusOf(
      [...lift('Squat (Barbell)', 8, 100), ...lift('Face Pull (Cable)', 8, 20)],
      'B',
      80,
    );
    expect(compareCorpora(a, b).theyDoYouDont.map((x) => x.name)).toEqual(['Face Pull (Cable)']);
  });

  it('ignores a lift they merely tried once or twice', () => {
    const a = corpusOf(lift('Squat (Barbell)', 8, 100), 'A', 80);
    const b = corpusOf([...lift('Squat (Barbell)', 8, 100), ...lift('Sled Push', 2, 60)], 'B', 80);
    expect(compareCorpora(a, b).theyDoYouDont).toEqual([]);
  });
});

/**
 * The real corpus, split in half and treated as two people. Measured, not
 * specified. Skips on a clone without the gitignored export.
 */
const present = hasRealFixture();

/** Splits the real export down the middle and treats the halves as two people. */
function splitReal() {
  const { sets } = parseCsv(readFileSync(REAL_FIXTURE, 'utf8'));
  const meta: Record<string, ExerciseMeta> = {};
  for (const n of [...new Set(sets.map((s) => s.exerciseName))]) meta[n] = guessMeta(n);
  const all = enrich(sets, meta, [], 86);
  const days = [...new Set(all.map((s) => s.date.toISOString().slice(0, 10)))].sort();
  const mid = days[Math.floor(days.length / 2)] as string;
  const pick = (f: (d: string) => boolean): EnrichedSet[] =>
    all.filter((s) => f(s.date.toISOString().slice(0, 10)));
  const mk = (label: string, s: EnrichedSet[]): Corpus => ({
    label,
    sets: s,
    meta: (n: string) => meta[n],
    bodyweightKg: 86,
  });
  return compareCorpora(
    mk('first half', pick((d) => d < mid)),
    mk('second half', pick((d) => d >= mid)),
  );
}

const halves = present ? splitReal() : null;

describe.skipIf(!present)('the reference corpus, split in half', () => {
  const c = halves!;

  it('finds the overlap is far from complete, even for one person', () => {
    expect(c.sharedNames.length).toBe(63);
    expect(c.yoursOnly.length).toBe(40);
    expect(c.theirsOnly.length).toBe(27);
  });

  it('narrows to a small comparable core', () => {
    // Most shared lifts still fail a gate: machine, cable, or thin history.
    expect(c.lifts.length).toBeLessThan(c.sharedNames.length / 2);
    expect(c.excluded.length).toBeGreaterThan(c.lifts.length);
  });

  it('keeps the free-weight barbell lifts and drops the machines', () => {
    expect(nameOf(c)).toContain('Squat (Barbell)');
    expect(nameOf(c)).toContain('Bench Press (Barbell)');
    expect(reasonFor(c, 'Leg Extension (Machine)')).toBe('machine-or-cable');
  });

  /**
   * The headline figures are the median session best, which sit well below the
   * PRs of 133 / 108 kg. That gap IS the estimator choice.
   */
  it('reports typical top sets, not personal bests', () => {
    const squat = c.lifts.find((l) => l.name === 'Squat (Barbell)');
    expect(squat).toBeDefined();
    expect(squat!.youKg).toBeLessThan(squat!.youPeakKg);
    expect(squat!.youKg).toBeGreaterThan(90);
    expect(squat!.youKg).toBeLessThan(120);
    expect(squat!.youPeakKg).toBeGreaterThan(120);
  });

  it('is deterministic', () => {
    const again = splitReal();
    expect(again.lifts.map((l) => l.name)).toEqual(c.lifts.map((l) => l.name));
    expect(again.excluded).toEqual(c.excluded);
    expect(again.lifts[0]?.ratio).toBe(c.lifts[0]?.ratio);
  });
});
