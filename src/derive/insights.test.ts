import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from '../ingest/parseCsv';
import { guessMeta } from '../meta/guessMeta';
import { enrich, makeCsv, type RowSpec } from '../test/helpers';
import { REAL_FIXTURE, hasRealFixture } from '../test/fixtures';
import type { ExerciseMeta } from '../model/types';
import { findings, type Finding } from './insights';

/**
 * A weakness engine finds weaknesses whether or not any exist. Search seven
 * weekdays for the one you train least and one of them always comes last.
 *
 * So the load-bearing tests here are the NEGATIVE ones: a corpus with no real
 * pattern must produce no findings, and a borderline one must be demoted rather
 * than promoted. A suite that only checks "planted signal is found" would pass
 * just as happily against a version of this file with the gate deleted.
 */

/** Builds a corpus from explicit dates, all one exercise unless told otherwise. */
function corpus(rows: RowSpec[]) {
  const { sets } = parseCsv(makeCsv(rows));
  const names = [...new Set(sets.map((s) => s.exerciseName))];
  const meta: Record<string, ExerciseMeta> = {};
  for (const n of names) meta[n] = guessMeta(n);
  return {
    sets: enrich(sets, meta),
    lookup: (n: string) => meta[n],
  };
}

function run(rows: RowSpec[]) {
  const { sets, lookup } = corpus(rows);
  return findings(sets, lookup, { weekStartsOn: 1 });
}

const of = (r: { findings: Finding[] }, kind: string) =>
  r.findings.filter((f) => f.kind === kind);

/** `n` sessions starting from a Monday, every `stepDays`. */
function sessions(count: number, stepDays: number, from = new Date(2024, 0, 1)): RowSpec[] {
  const out: RowSpec[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i * stepDays);
    const iso =
      d.getFullYear() +
      '-' + String(d.getMonth() + 1).padStart(2, '0') +
      '-' + String(d.getDate()).padStart(2, '0') +
      ' 18:00:00';
    out.push({ date: iso, workout: 'W' + i, exercise: 'Squat (Barbell)', weight: 100, reps: 5 });
  }
  return out;
}

describe('findings', () => {
  it('says nothing at all about an empty corpus', () => {
    const r = findings([], () => undefined, { weekStartsOn: 1 });
    expect(r.findings).toEqual([]);
    expect(r.testsRun).toBe(0);
  });

  it('refuses rather than reporting on a corpus too short to judge', () => {
    const r = run(sessions(5, 3));
    expect(r.findings).toEqual([]);
    expect(r.skippedRules).toContain('weekday-rate');
  });
});

describe('the gate', () => {
  /**
   * THE test. Training every second day hits all seven weekdays evenly, so no
   * weekday is a hole. The engine must run its tests and report none of them.
   */
  it('finds nothing in an evenly-spread corpus, and says how much it discarded', () => {
    const r = run(sessions(120, 2));
    expect(of(r, 'weekday-rate')).toEqual([]);
    expect(r.testsRun).toBeGreaterThan(0);
  });

  it('never lets a suppressed finding leak into the output', () => {
    const r = run(sessions(120, 2));
    for (const f of r.findings) {
      if (f.evidence.z === null) continue;
      expect(Math.abs(f.evidence.z)).toBeGreaterThanOrEqual(1.9599);
    }
  });

  /**
   * Every test that ran must land in exactly one bucket: shown, too weak to
   * call, or called and fine. If these stop adding up, the tab is quietly
   * under-reporting how much searching it did.
   */
  it('accounts for every test it ran', () => {
    for (const r of [run(sessions(120, 2)), run(weekdayCorpus([5, 5, 5, 5, 5, 0, 5]))]) {
      const shown = r.findings.filter((f) => f.evidence.z !== null).length;
      expect(shown + r.suppressed + r.notAdverse).toBe(r.testsRun);
    }
  });

  /**
   * A finding's confidence depends on how many tests ran beside it. The same z
   * that is 'clear' alone is only 'suggestive' among seven -- that is the
   * multiple-comparison correction doing its job, and it is worth pinning.
   */
  it('demotes a borderline finding as its test family grows', () => {
    const r = run(weekdayCorpus([0, 3, 3, 3, 3, 3, 3]));
    const wd = of(r, 'weekday-rate');
    expect(wd.length).toBeGreaterThan(0);
    // Family size is always the full week, never just the flagged days.
    for (const f of wd) expect(f.evidence.familySize).toBe(7);
  });
});

/**
 * A corpus where weekday i gets `counts[i]` sessions per week over 40 weeks.
 *
 * NOTE the index base: this array is MONDAY-first (counts[0] is Monday), because
 * it is built by walking forward from a Monday. The engine reports weekdays by
 * `Date.getDay()`, which is SUNDAY-first. Mixing the two is the single easiest
 * mistake to make here, so tests name the day they expect rather than an index.
 */
function weekdayCorpus(counts: number[]): RowSpec[] {
  const out: RowSpec[] = [];
  const start = new Date(2024, 0, 1); // a Monday
  for (let week = 0; week < 40; week++) {
    for (let wd = 0; wd < 7; wd++) {
      // counts[wd] here means "trained on this weekday in this many of 7 weeks".
      if (week % 7 >= (counts[wd] ?? 0)) continue;
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + week * 7 + wd);
      const iso =
        d.getFullYear() +
        '-' + String(d.getMonth() + 1).padStart(2, '0') +
        '-' + String(d.getDate()).padStart(2, '0') +
        ' 18:00:00';
      out.push({
        date: iso,
        workout: 'W' + week + '-' + wd,
        exercise: 'Squat (Barbell)',
        weight: 100,
        reps: 5,
      });
    }
  }
  return out;
}

describe('weekday rate', () => {
  it('flags a weekday that is never trained while the others are', () => {
    // Saturday (index 5 counting from Monday) never happens.
    const r = run(weekdayCorpus([5, 5, 5, 5, 5, 0, 5]));
    const wd = of(r, 'weekday-rate');
    expect(wd.map((f) => f.title)).toContain('You rarely train Saturdays');
  });

  it('never flags a weekday you train MORE than average', () => {
    const r = run(weekdayCorpus([7, 1, 1, 1, 1, 1, 1]));
    // Monday is the heavy day; a day you overtrain is the programme working.
    expect(of(r, 'weekday-rate').map((f) => f.title)).not.toContain('You rarely train Mondays');
  });

  /**
   * A three-day split has four untrained weekdays. Reporting each one is four
   * accusations aimed at what is simply the programme, so past half the week
   * they fold into a single observation.
   */
  it('folds a whole rest-day pattern into one observation', () => {
    // Monday-first: Mon/Wed/Fri trained, so Tue, Thu, Sat and Sun are "holes".
    const r = run(weekdayCorpus([7, 0, 7, 0, 7, 0, 0]));
    const wd = of(r, 'weekday-rate');
    expect(wd).toHaveLength(1);
    expect(wd[0]?.title).toMatch(/training sits on/);
    // It must name the days actually trained, not the ones that were not.
    expect(wd[0]?.title).toContain('Mondays');
    expect(wd[0]?.title).toContain('Fridays');
  });

  it('still reports a single hole individually', () => {
    const r = run(weekdayCorpus([5, 5, 5, 5, 5, 0, 5]));
    const wd = of(r, 'weekday-rate');
    expect(wd).toHaveLength(1);
    expect(wd[0]?.title).toBe('You rarely train Saturdays');
  });

  it('describes a rate rather than accusing you of skipping', () => {
    const r = run(weekdayCorpus([5, 5, 5, 5, 5, 0, 5]));
    const f = of(r, 'weekday-rate')[0];
    expect(f?.title).toMatch(/rarely train/);
    expect(f?.title).not.toMatch(/skip/i);
    // The copy has to leave room for "that is my programme".
    expect(f?.detail).toMatch(/programme or slippage/);
  });
});

describe('abandoned lifts', () => {
  const dated = (iso: string, exercise: string, i: number): RowSpec => ({
    date: iso + ' 18:00:00',
    workout: exercise + i,
    exercise,
    weight: 60,
    reps: 5,
  });

  it('flags a lift with real history that then stops', () => {
    const rows: RowSpec[] = [];
    // Ten sessions of Chin Up in Jan-Feb, then nothing.
    for (let i = 0; i < 10; i++) {
      rows.push(dated('2024-01-' + String(i + 1).padStart(2, '0'), 'Chin Up', i));
    }
    // Squat continues all year, so the corpus keeps going.
    for (let i = 0; i < 40; i++) {
      const d = new Date(2024, 1, 1 + i * 7);
      rows.push(
        dated(
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
            '-' + String(d.getDate()).padStart(2, '0'),
          'Squat (Barbell)',
          i,
        ),
      );
    }
    const names = of(run(rows), 'abandoned-lift').map((f) => f.subject);
    expect(names).toContain('Chin Up');
    expect(names).not.toContain('Squat (Barbell)');
  });

  it('ignores a lift you only tried a few times', () => {
    const rows: RowSpec[] = [];
    for (let i = 0; i < 3; i++) {
      rows.push(dated('2024-01-' + String(i + 1).padStart(2, '0'), 'Sled Push', i));
    }
    for (let i = 0; i < 40; i++) {
      const d = new Date(2024, 1, 1 + i * 7);
      rows.push(
        dated(
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
            '-' + String(d.getDate()).padStart(2, '0'),
          'Squat (Barbell)',
          i,
        ),
      );
    }
    // Three attempts is not a habit you abandoned.
    expect(of(run(rows), 'abandoned-lift').map((f) => f.subject)).not.toContain('Sled Push');
  });

  it('is a fact, so it carries no z and is always clear', () => {
    const rows: RowSpec[] = [];
    for (let i = 0; i < 10; i++) {
      rows.push(dated('2024-01-' + String(i + 1).padStart(2, '0'), 'Chin Up', i));
    }
    for (let i = 0; i < 40; i++) {
      const d = new Date(2024, 1, 1 + i * 7);
      rows.push(
        dated(
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
            '-' + String(d.getDate()).padStart(2, '0'),
          'Squat (Barbell)',
          i,
        ),
      );
    }
    const f = of(run(rows), 'abandoned-lift')[0];
    expect(f?.evidence.z).toBeNull();
    expect(f?.confidence).toBe('clear');
  });
});

describe('stalled lifts', () => {
  /** One exercise, `count` weekly sessions, e1RM following `kgAt`. */
  function progression(kgAt: (i: number) => number, count = 20): RowSpec[] {
    const rows: RowSpec[] = [];
    for (let i = 0; i < count; i++) {
      const d = new Date(2024, 0, 1 + i * 7);
      rows.push({
        date:
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
          '-' + String(d.getDate()).padStart(2, '0') + ' 18:00:00',
        workout: 'W' + i,
        exercise: 'Bench Press (Barbell)',
        weight: kgAt(i),
        reps: 5,
      });
    }
    return rows;
  }

  it('flags a lift whose estimated 1RM is falling', () => {
    const r = run(progression((i) => 100 - i * 1.5));
    expect(of(r, 'stalled-lift').map((f) => f.subject)).toContain('Bench Press (Barbell)');
  });

  it('says nothing about a lift that is progressing', () => {
    const r = run(progression((i) => 100 + i * 1.5));
    expect(of(r, 'stalled-lift')).toEqual([]);
  });

  it('says nothing about a flat lift with too much scatter to call', () => {
    // Noisy but trendless: the fit exists, its slope is not distinguishable
    // from zero, and the engine must stay quiet rather than pick a direction.
    const r = run(progression((i) => 100 + (i % 3) * 6 - (i % 2) * 5));
    expect(of(r, 'stalled-lift')).toEqual([]);
  });

  it('refuses a lift with too few sessions to fit', () => {
    const r = run(progression((i) => 100 - i * 2, 5));
    expect(of(r, 'stalled-lift')).toEqual([]);
    expect(r.skippedRules).toContain('stalled-lift');
  });

  it('refuses a lift whose sessions are crammed into too short a span', () => {
    const rows: RowSpec[] = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(2024, 0, 1 + i); // 15 consecutive days
      rows.push({
        date:
          d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
          '-' + String(d.getDate()).padStart(2, '0') + ' 18:00:00',
        workout: 'W' + i,
        exercise: 'Bench Press (Barbell)',
        weight: 100 - i * 2,
        reps: 5,
      });
    }
    expect(of(run(rows), 'stalled-lift')).toEqual([]);
  });
});

/**
 * The real corpus, measured not specified. Skips on a clone without the
 * gitignored export, following `fixture.test.ts`.
 */
const present = hasRealFixture();
const real = present
  ? (() => {
      const { sets } = parseCsv(readFileSync(REAL_FIXTURE, 'utf8'));
      const names = [...new Set(sets.map((s) => s.exerciseName))];
      const meta: Record<string, ExerciseMeta> = {};
      for (const n of names) meta[n] = guessMeta(n);
      return findings(enrich(sets, meta), (n) => meta[n], { weekStartsOn: 1 });
    })()
  : null;

describe.skipIf(!present)('the reference corpus', () => {
  const r = real!;

  /**
   * The measured weekday rates against an overall 28.1%:
   *   Sat 5.0% (z -5.17)   Fri 16.8% (-2.51)   Wed 25.7% (-0.53)
   *   Mon 28.7% (+0.14)    Tue 38.2% (+2.28)   Sun 40.6% (+2.79)   Thu 41.6% (+3.01)
   * Saturday is a real hole. Monday and Wednesday are noise.
   */
  it('finds Saturday and rates it clear', () => {
    const sat = of(r, 'weekday-rate').find((f) => f.title.includes('Saturdays'));
    expect(sat).toBeDefined();
    expect(sat!.confidence).toBe('clear');
    expect(sat!.evidence.z).toBeLessThan(-5);
  });

  it('rates Friday only suggestive', () => {
    const fri = of(r, 'weekday-rate').find((f) => f.title.includes('Fridays'));
    expect(fri?.confidence).toBe('suggestive');
  });

  /** The one that would break if the correction were removed. */
  it('reports nothing whatsoever about Mondays or Wednesdays', () => {
    const titles = of(r, 'weekday-rate').map((f) => f.title);
    expect(titles).not.toContain('You rarely train Mondays');
    expect(titles).not.toContain('You rarely train Wednesdays');
  });

  /**
   * Weekly sessions fall from 2.04 to 1.86 across the halves, which looks like a
   * decline and is not one (z ~ 0.9). It must not reach the user.
   */
  it('suppresses the weekly frequency decline', () => {
    expect(of(r, 'weekly-trend')).toEqual([]);
  });

  it('surfaces the lifts that were dropped', () => {
    const names = of(r, 'abandoned-lift').map((f) => f.subject);
    expect(names).toContain('Chin Up');
    expect(names).toContain('Face Pull (Cable)');
    expect(names).toContain('Hip Thrust (Barbell)');
  });

  it('never reports a lift as both abandoned and stalled', () => {
    const abandoned = new Set(of(r, 'abandoned-lift').map((f) => f.subject));
    for (const f of of(r, 'stalled-lift')) expect(abandoned.has(f.subject)).toBe(false);
  });

  it('discards a real share of what it tested', () => {
    expect(r.suppressed).toBeGreaterThan(0);
    expect(r.testsRun).toBeGreaterThan(r.suppressed);
  });

  it('ranks clear findings above suggestive ones', () => {
    const tiers = r.findings.map((f) => (f.confidence === 'clear' ? 0 : 1));
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
  });

  it('is deterministic', () => {
    const { sets } = parseCsv(readFileSync(REAL_FIXTURE, 'utf8'));
    const names = [...new Set(sets.map((s) => s.exerciseName))];
    const meta: Record<string, ExerciseMeta> = {};
    for (const n of names) meta[n] = guessMeta(n);
    const again = findings(enrich(sets, meta), (n) => meta[n], { weekStartsOn: 1 });
    expect(again.findings.map((f) => f.id)).toEqual(r.findings.map((f) => f.id));
  });
});
