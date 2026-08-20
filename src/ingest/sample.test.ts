import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from './parseCsv';
import { splitLines } from './sniffDelimiter';
import { buildMetaIndex } from '../meta/metaIndex';
import { guessMeta } from '../meta/guessMeta';
import { seedFor } from '../meta/seedMeta';
import { makeBodyweightResolver } from '../model/bodyweight';
import { enrichSets } from '../model/effectiveLoad';
import { cooccurrence } from '../derive/cooccurrence';
import { sessionBests } from '../derive/series';
import { segmentByGap } from '../derive/stats';
import { volume } from '../derive';
import { SAMPLE_FIXTURE } from '../test/fixtures';
import type { ExerciseMeta } from '../model/types';

/**
 * The suite a fresh clone runs.
 *
 * The real export is gitignored (it is one person's actual training history), so
 * these assertions run against the synthetic corpus produced by
 * `scripts/make-sample-fixture.mjs`. That generator exists precisely so this file
 * can still guard the quirks that matter -- above all the isometric-hold trap,
 * which is invisible to any test whose corpus lacks those rows.
 *
 * The numbers below are measured from the committed sample, which is
 * deterministic. Regenerating it without updating them should fail loudly.
 */
const text = readFileSync(SAMPLE_FIXTURE, 'utf8');
const parsed = parseCsv(text, { filename: 'sample_workouts.csv' });
const { sets, workouts, report } = parsed;

const EXPECTED = {
  dataRows: 1512,
  nonRest: 927,
  restRows: 585,
  working: 840,
  warmup: 84,
  drop: 3,
  workouts: 42,
  exercises: 19,
  // Rows carrying a seconds value: timed holds AND the cardio rows, exactly as a
  // real export mixes them.
  secondsRows: 49,
  planks: 42,
  distance: 7,
  zeroRep: 1,
} as const;

describe('sample fixture: file shape matches a real Strong export', () => {
  it('is CRLF, has no BOM, and ends without a trailing newline', () => {
    expect(text.startsWith('﻿')).toBe(false);
    expect(text).toContain('\r\n');
    // A real export ends mid-line on an empty RPE field. The parser must cope.
    expect(text.endsWith('\n')).toBe(false);
  });

  it('reads one row per data line', () => {
    const lines = splitLines(text).filter((l) => l.trim() !== '');
    expect(lines.length - 1).toBe(EXPECTED.dataRows);
    expect(report.rowsRead).toBe(EXPECTED.dataRows);
  });

  it('detects the delimiter and recognises the German headers', () => {
    expect(report.delimiter).toBe(',');
    expect(report.delimiterConfident).toBe(true);
    expect(report.headersUnrecognised).toEqual([]);
  });
});

describe('sample fixture: row classification', () => {
  it('splits into the measured set and rest counts', () => {
    expect(report.setsParsed).toBe(EXPECTED.nonRest);
    expect(report.restRowsSeen).toBe(EXPECTED.restRows);
    expect(report.setsParsed + report.restRowsSeen).toBe(EXPECTED.dataRows);
  });

  it('accounts for every rest row', () => {
    expect(report.restRowsCollapsed + report.orphanRestRows + report.malformedRestRows).toBe(
      EXPECTED.restRows,
    );
    // The sample deliberately includes one rest row with seconds = 0, which only
    // the localised-token path can classify -- the structural test misses it.
    expect(report.malformedRestRows).toBe(1);
  });

  it('counts warm-ups, drop sets and working sets', () => {
    expect(report.warmupSets).toBe(EXPECTED.warmup);
    expect(report.dropSets).toBe(EXPECTED.drop);
    expect(report.workingSets).toBe(EXPECTED.working);
    expect(report.workingSets + report.warmupSets + report.dropSets).toBe(EXPECTED.nonRest);
  });

  it('leaves no unknown token and no unparseable date', () => {
    expect(report.unknownTokens).toEqual([]);
    expect(report.dateParseFailures).toBe(0);
  });

  /**
   * The single most important assertion in this file.
   *
   * Isometric holds carry seconds > 0, reps == 0 AND weight == 0 -- structurally
   * identical to a rest row. Only their numeric set order distinguishes them. If
   * classifyRow ever tests structure before numerics, they vanish silently.
   */
  it('keeps isometric holds as sets rather than swallowing them as rest', () => {
    expect(report.isometricSets).toBe(EXPECTED.secondsRows);
    const holds = sets.filter((s) => (s.seconds ?? 0) > 0);
    expect(holds).toHaveLength(EXPECTED.secondsRows);

    // The dangerous ones: bare rows whose only data is seconds. These are
    // byte-identical to a rest row apart from their numeric set order.
    const planks = holds.filter((s) => s.exerciseName === 'Plank');
    expect(planks).toHaveLength(EXPECTED.planks);
    expect(planks.every((s) => (s.reps ?? 0) === 0 && (s.weightKg ?? 0) === 0)).toBe(true);
    expect(planks.every((s) => s.setKind === 'working')).toBe(true);
  });

  it('collapses rest onto the preceding set and never emits it as one', () => {
    const withRest = sets.filter((s) => s.restAfterSec !== null);
    expect(withRest.length).toBeGreaterThan(0);
    expect(withRest.every((s) => (s.restAfterSec ?? 0) > 0)).toBe(true);
  });
});

describe('sample fixture: content and data-quality traps', () => {
  it('finds the measured exercise and workout counts', () => {
    expect(report.exerciseNames.length).toBe(EXPECTED.exercises);
    expect(workouts.length).toBe(EXPECTED.workouts);
  });

  it('trims the whitespace-dirty name and reports the trim', () => {
    expect(report.trimmedNames).toEqual(['Single Leg Extension ']);
    expect(report.nameCollisions).toEqual([]);
    expect(report.exerciseNames).toContain('Single Leg Extension');
  });

  it('carries the sparse columns', () => {
    expect(report.distanceRows).toBe(EXPECTED.distance);
    expect(report.zeroRepSets).toBe(EXPECTED.zeroRep);
    expect(sets.every((s) => s.rpe === null)).toBe(true);
  });

  it('includes the parenthetical traps a real export contains', () => {
    const names = report.exerciseNames;
    expect(names).toContain('Bicep Curl Bench (Dumbell)'); // misspelling
    expect(names).toContain('Push Up (Knees)'); // variation, not equipment
    expect(names).toContain('Triceps Pushdown (Cable - Straight Bar)'); // compound
  });
});

describe('sample fixture: structural invariants', () => {
  it('gives every set a unique id', () => {
    expect(new Set(sets.map((s) => s.id)).size).toBe(sets.length);
  });

  it('numbers setOrder densely from 1 within each (workout, exercise)', () => {
    const seen = new Map<string, number[]>();
    for (const s of sets) {
      const k = s.workoutId + '|' + s.exerciseName;
      const list = seen.get(k) ?? [];
      list.push(s.setOrder);
      seen.set(k, list);
    }
    for (const [k, orders] of seen) {
      expect(orders, k).toEqual(orders.map((_, i) => i + 1));
    }
  });

  it('keeps workout.setIds consistent with the emitted sets', () => {
    const ids = new Set(sets.map((s) => s.id));
    expect(workouts.reduce((n, w) => n + w.setIds.length, 0)).toBe(sets.length);
    for (const w of workouts) for (const id of w.setIds) expect(ids.has(id)).toBe(true);
  });

  it('re-parsing identical text is deterministic', () => {
    const again = parseCsv(text);
    expect(again.sets.map((s) => s.id)).toEqual(sets.map((s) => s.id));
  });
});

// --- the metadata + derive path -----------------------------------------------

function buildMeta(): Record<string, ExerciseMeta> {
  const out: Record<string, ExerciseMeta> = {};
  for (const s of sets) {
    if (!out[s.exerciseName]) out[s.exerciseName] = seedFor(s.exerciseName) ?? guessMeta(s.exerciseName);
  }
  return out;
}
const meta = buildMeta();
const lookup = (n: string) => meta[n];
const enriched = enrichSets(
  sets,
  buildMetaIndex(meta),
  makeBodyweightResolver([{ date: '2023-01-09', kg: 75 }], 80),
);

describe('sample fixture: derived metrics', () => {
  it('gives every exercise metadata, none auto-confirmed', () => {
    expect(Object.keys(meta)).toHaveLength(EXPECTED.exercises);
    expect(Object.values(meta).every((m) => m.confirmed === false)).toBe(true);
  });

  it('parses equipment, including the misspelling and the variation', () => {
    expect(meta['Squat (Barbell)']?.equipment).toBe('barbell');
    expect(meta['Bicep Curl Bench (Dumbell)']?.equipment).toBe('dumbbell');
    expect(meta['Triceps Pushdown (Cable - Straight Bar)']?.equipment).toBe('cable');
    expect(meta['Push Up (Knees)']?.equipment).toBe('unknown');
  });

  it('gives bodyweight and loaded pull ups both non-zero volume', () => {
    const pullUps = enriched.filter((s) => s.canonicalName === 'Pull Up');
    expect(pullUps.length).toBeGreaterThan(0);
    expect(meta['Pull Up']?.loadType).toBe('bodyweight-plus');

    const bodyweight = pullUps.filter((s) => (s.weightKg ?? 0) === 0);
    const loaded = pullUps.filter((s) => (s.weightKg ?? 0) > 0);
    expect(bodyweight.length).toBeGreaterThan(0);
    expect(loaded.length).toBeGreaterThan(0);
    expect(volume(bodyweight).volumeKg).toBeGreaterThan(0);
    expect(volume(loaded).volumeKg).toBeGreaterThan(0);
  });

  it('flags empty-bar squats as unloaded and excludes them from volume', () => {
    const squats = enriched.filter((s) => s.canonicalName === 'Squat (Barbell)');
    const unloaded = squats.filter((s) => s.isUnloaded);
    expect(unloaded.length).toBeGreaterThan(0);

    const v = volume(squats);
    expect(v.excludedUnloaded).toBe(unloaded.length);
    expect(v.volumeKg).toBeGreaterThan(0);
  });

  it('excludes timed work from volume without discarding the sets', () => {
    const planks = enriched.filter((s) => s.canonicalName === 'Plank');
    expect(planks.length).toBe(EXPECTED.planks);
    expect(meta['Plank']?.loadType).toBe('duration');
    expect(volume(planks).volumeKg).toBe(0);
  });

  it('recovers the push/pull/legs structure the sample was built with', () => {
    const split = cooccurrence(enriched, lookup);
    expect(split.clusters.length).toBeGreaterThanOrEqual(2);
    expect(split.wellSeparated).toBe(true);

    // Exercises programmed in the same session must land together.
    const clusterOf = (n: string) => split.clusters.findIndex((c) => c.members.includes(n));
    expect(clusterOf('Squat (Barbell)')).toBe(clusterOf('Leg Press'));
    expect(clusterOf('Pull Up')).toBe(clusterOf('Seated Row (Cable)'));
    expect(clusterOf('Bench Press (Barbell)')).toBe(clusterOf('Overhead Press (Barbell)'));
  });

  it('breaks a progression series across the built-in layoff', () => {
    const squats = enriched.filter((s) => s.canonicalName === 'Squat (Barbell)');
    const segments = segmentByGap(sessionBests(squats), 28);
    // The generator inserts one gap longer than 28 days.
    expect(segments.length).toBeGreaterThan(1);
  });

  it('reports per-session volume consistent with the shared helper', () => {
    const squats = enriched.filter((s) => s.canonicalName === 'Squat (Barbell)');
    const bests = sessionBests(squats);
    const summed = bests.reduce((n, b) => n + b.volumeKg, 0);
    expect(summed).toBeCloseTo(volume(squats).volumeKg, 6);
  });
});
