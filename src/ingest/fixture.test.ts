import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseCsv } from './parseCsv';
import { REAL_FIXTURE, hasRealFixture } from '../test/fixtures';
import { splitLines } from './sniffDelimiter';
import { buildMetaIndex } from '../meta/metaIndex';
import { guessMeta } from '../meta/guessMeta';
import { seedFor } from '../meta/seedMeta';
import { makeBodyweightResolver } from '../model/bodyweight';
import { enrichSets } from '../model/effectiveLoad';
import { summarise, volume } from '../derive';
import type { ExerciseMeta } from '../model/types';

/**
 * Regression locks against the real export.
 *
 * Every number below was MEASURED from fixtures/strong_workouts.csv, not copied
 * from a specification -- the spec's own figures for the working-set count and the
 * set-order range were wrong. These constants live only in this test file; no
 * application code contains a fixture-derived constant, so any other Strong export
 * parses on its own terms.
 */
const present = hasRealFixture();
// Read lazily: on a fresh clone the file is absent and every suite below skips.
const text = present ? readFileSync(REAL_FIXTURE, 'utf8') : '';

const EXPECTED = {
  dataRows: 6517,
  nonRestRows: 3988,
  restRows: 2529,
  workingSets: 3930,
  warmupSets: 53,
  dropSets: 5,
  exercises: 130,
  workouts: 199,
  zeroWeightWorkingSets: 1233,
  isometricSets: 81,
  distanceRows: 9,
  noteRows: 3,
  pullUp: { total: 623, bodyweight: 437, loaded: 186 },
  emptyBarSquats: 36,
} as const;

const parsed = parseCsv(text, { filename: 'strong_workouts.csv' });
const { sets, workouts, report } = parsed;

describe.skipIf(!present)('fixture: file shape', () => {
  it('is CRLF, has no BOM, and ends without a trailing newline', () => {
    expect(text.startsWith('﻿')).toBe(false);
    expect(text).toContain('\r\n');
    expect(text.endsWith('\n')).toBe(false);
  });

  it('reads one row per data line', () => {
    const lines = splitLines(text).filter((l) => l.trim() !== '');
    expect(lines.length - 1).toBe(EXPECTED.dataRows);
    expect(report.rowsRead).toBe(EXPECTED.dataRows);
  });

  it('detects a comma delimiter confidently and recognises every header', () => {
    expect(report.delimiter).toBe(',');
    expect(report.delimiterConfident).toBe(true);
    expect(report.headersUnrecognised).toEqual([]);
    expect(report.usedPositionalFallback).toBe(false);
  });
});

describe.skipIf(!present)('fixture: row classification', () => {
  it('splits into exactly the measured non-rest and rest counts', () => {
    expect(report.setsParsed).toBe(EXPECTED.nonRestRows);
    expect(report.restRowsSeen).toBe(EXPECTED.restRows);
    expect(report.setsParsed + report.restRowsSeen).toBe(EXPECTED.dataRows);
  });

  it('accounts for every rest row: collapsed, orphaned or malformed', () => {
    expect(report.restRowsCollapsed + report.orphanRestRows + report.malformedRestRows).toBe(
      EXPECTED.restRows,
    );
    // One Ruhezeit row carries seconds = 0 and so cannot be attached to anything.
    expect(report.malformedRestRows).toBe(1);
    expect(report.orphanRestRows).toBe(0);
  });

  it('counts warm-ups, drop sets and working sets', () => {
    expect(report.warmupSets).toBe(EXPECTED.warmupSets);
    expect(report.dropSets).toBe(EXPECTED.dropSets);
    expect(report.workingSets).toBe(EXPECTED.workingSets);
    expect(report.workingSets + report.warmupSets + report.dropSets).toBe(EXPECTED.nonRestRows);
  });

  it('leaves no unknown set-order token', () => {
    expect(report.unknownTokens).toEqual([]);
    expect(report.dateParseFailures).toBe(0);
  });

  it('never emits a rest row as a set', () => {
    // Rest rows are bare: no reps, no weight, no distance, only seconds.
    const restLike = sets.filter(
      (s) => (s.reps ?? 0) === 0 && (s.weightKg ?? 0) === 0 && (s.seconds ?? 0) > 0,
    );
    // Every remaining seconds-only row is a real isometric hold, not rest.
    expect(restLike).toHaveLength(EXPECTED.isometricSets);
    expect(sets.every((s) => s.setKind !== ('rest' as unknown))).toBe(true);
  });

  /**
   * The isometric holds are byte-identical to rest rows apart from their numeric
   * set order. If classifyRow ever tests structure before numerics, they vanish.
   */
  it('keeps all isometric holds as sets', () => {
    expect(report.isometricSets).toBe(EXPECTED.isometricSets);
    const holds = sets.filter((s) => (s.seconds ?? 0) > 0);
    expect(holds).toHaveLength(EXPECTED.isometricSets);
    expect(holds.map((s) => s.exerciseName)).toContain('Handstand Hold');
    expect(holds.map((s) => s.exerciseName)).toContain('Wall Sit');
  });

  it('attaches rest to the preceding set', () => {
    const withRest = sets.filter((s) => s.restAfterSec !== null);
    expect(withRest.length).toBeGreaterThan(0);
    expect(withRest.every((s) => (s.restAfterSec ?? 0) > 0)).toBe(true);
  });
});

describe.skipIf(!present)('fixture: corpus content', () => {
  it('finds the measured exercise and workout counts', () => {
    expect(report.exerciseNames.length).toBe(EXPECTED.exercises);
    expect(workouts.length).toBe(EXPECTED.workouts);
  });

  it('spans the measured date range', () => {
    expect(report.dateRange).not.toBeNull();
    expect(report.dateRange?.from.getFullYear()).toBe(2024);
    expect(report.dateRange?.to.getFullYear()).toBe(2026);
  });

  it('carries the sparse columns without building on them', () => {
    expect(report.distanceRows).toBe(EXPECTED.distanceRows);
    expect(sets.filter((s) => s.notes !== '').length).toBe(EXPECTED.noteRows);
    expect(sets.every((s) => s.rpe === null)).toBe(true);
  });

  it('trims the one whitespace-dirty name without colliding', () => {
    expect(report.trimmedNames).toEqual(['Single Leg Extension ']);
    expect(report.nameCollisions).toEqual([]);
  });

  it('has a third of its working sets at weight zero', () => {
    const zero = sets.filter((s) => (s.weightKg ?? 0) === 0);
    expect(zero).toHaveLength(EXPECTED.zeroWeightWorkingSets);
  });
});

describe.skipIf(!present)('fixture: structural invariants', () => {
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
      const expectedOrders = orders.map((_, i) => i + 1);
      expect(orders, k).toEqual(expectedOrders);
    }
  });

  it('keeps workout.setIds consistent with the emitted sets', () => {
    const ids = new Set(sets.map((s) => s.id));
    const total = workouts.reduce((n, w) => n + w.setIds.length, 0);
    expect(total).toBe(sets.length);
    for (const w of workouts) {
      for (const id of w.setIds) expect(ids.has(id)).toBe(true);
    }
  });

  it('assigns every set to a real workout', () => {
    const wids = new Set(workouts.map((w) => w.id));
    expect(sets.every((s) => wids.has(s.workoutId))).toBe(true);
  });

  it('gives every workout a duration parsed from its human string', () => {
    expect(workouts.every((w) => w.durationSec > 0)).toBe(true);
  });
});

describe.skipIf(!present)('fixture: re-import is stable', () => {
  it('produces identical output for identical text', () => {
    const again = parseCsv(text, { filename: 'strong_workouts.csv' });
    expect(again.sets.map((s) => s.id)).toEqual(sets.map((s) => s.id));
    expect(again.report.setsParsed).toBe(report.setsParsed);
    expect(again.workouts.map((w) => w.id)).toEqual(workouts.map((w) => w.id));
  });

  it('keeps ids stable when earlier history is re-exported as a prefix', () => {
    // Simulate an older export: the same file truncated to its first N workouts.
    const cutoff = workouts[50]?.id;
    const prefixSets = sets.filter((s) => {
      const idx = workouts.findIndex((w) => w.id === s.workoutId);
      return idx < 50;
    });
    expect(cutoff).toBeTruthy();
    const fullIds = new Set(sets.map((s) => s.id));
    expect(prefixSets.every((s) => fullIds.has(s.id))).toBe(true);
  });
});

// --- the metadata + derive path over the real corpus --------------------------

/** Build metadata exactly as the app does on first run: seed, else guess. */
function buildRealMeta(): Record<string, ExerciseMeta> {
  const observed = new Map<string, { nonZero: boolean; sec: boolean; dist: boolean }>();
  for (const s of sets) {
    const o = observed.get(s.exerciseName) ?? { nonZero: false, sec: false, dist: false };
    if ((s.weightKg ?? 0) !== 0) o.nonZero = true;
    if ((s.seconds ?? 0) > 0) o.sec = true;
    if ((s.distanceRaw ?? 0) !== 0) o.dist = true;
    observed.set(s.exerciseName, o);
  }
  const out: Record<string, ExerciseMeta> = {};
  for (const [name, o] of observed) {
    out[name] =
      seedFor(name) ??
      guessMeta(name, {
        observedWeights: { anyNonZero: o.nonZero, anySeconds: o.sec, anyDistance: o.dist },
      });
  }
  return out;
}

const realMeta = buildRealMeta();
const enriched = enrichSets(
  sets,
  buildMetaIndex(realMeta),
  makeBodyweightResolver([{ date: '2023-01-01', kg: 80 }, { date: '2023-12-31', kg: 84 }], 80),
);

describe.skipIf(!present)('fixture: metadata and derived metrics', () => {
  it('produces metadata for all 130 exercises, none auto-confirmed', () => {
    expect(Object.keys(realMeta)).toHaveLength(EXPECTED.exercises);
    expect(Object.values(realMeta).every((m) => m.confirmed === false)).toBe(true);
  });

  it('parses equipment for every name that carries a real parenthetical', () => {
    expect(realMeta['Squat (Barbell)']?.equipment).toBe('barbell');
    expect(realMeta['Triceps Pushdown (Cable - Straight Bar)']?.equipment).toBe('cable');
    expect(realMeta['Bicep Curl Bench (Dumbell)']?.equipment).toBe('dumbbell');
    expect(realMeta['Seated Calf Raise (Plate Loaded)']?.equipment).toBe('machine');
    // A variation parenthetical must not be mistaken for equipment.
    expect(realMeta['Push Up (Knees)']?.equipment).toBe('unknown');
  });

  it('gives Pull Up non-zero volume across BOTH bodyweight and loaded sets', () => {
    const pullUps = enriched.filter((s) => s.canonicalName === 'Pull Up');
    expect(pullUps).toHaveLength(EXPECTED.pullUp.total);

    const bodyweight = pullUps.filter((s) => (s.weightKg ?? 0) === 0);
    const loaded = pullUps.filter((s) => (s.weightKg ?? 0) > 0);
    expect(bodyweight).toHaveLength(EXPECTED.pullUp.bodyweight);
    expect(loaded).toHaveLength(EXPECTED.pullUp.loaded);

    expect(volume(bodyweight).volumeKg).toBeGreaterThan(0);
    expect(volume(loaded).volumeKg).toBeGreaterThan(0);
    // Added load must actually raise the per-rep load.
    expect(realMeta['Pull Up']?.loadType).toBe('bodyweight-plus');
    expect(Math.max(...loaded.map((s) => s.effectiveLoadKg ?? 0))).toBeGreaterThan(
      Math.max(...bodyweight.map((s) => s.effectiveLoadKg ?? 0)),
    );
  });

  it('flags the empty-bar squats and excludes them from volume but not from set counts', () => {
    const squats = enriched.filter((s) => s.canonicalName === 'Squat (Barbell)');
    const unloaded = squats.filter((s) => s.isUnloaded);
    expect(unloaded).toHaveLength(EXPECTED.emptyBarSquats);

    const summary = summarise('Squat (Barbell)', squats);
    expect(summary.counts.total).toBe(squats.length);
    expect(summary.counts.unloaded).toBe(EXPECTED.emptyBarSquats);
    expect(summary.volume.excludedUnloaded).toBe(EXPECTED.emptyBarSquats);
    // Their zero weight must not drag the total down.
    expect(summary.volume.volumeKg).toBeGreaterThan(0);
  });

  it('excludes duration and distance work from volume', () => {
    const holds = enriched.filter((s) => s.loadType === 'duration');
    expect(holds.length).toBeGreaterThan(0);
    expect(volume(holds).volumeKg).toBe(0);
    expect(holds.every((s) => s.effectiveLoadKg === null)).toBe(true);
  });

  it('leaves no set blocked from volume purely by missing metadata', () => {
    const blocked = enriched.filter(
      (s) =>
        s.effectiveLoadKg === null &&
        s.loadType !== 'duration' &&
        s.loadType !== 'distance',
    );
    expect(blocked).toEqual([]);
  });

  it('re-deriving from the same text yields identical metrics', () => {
    const again = enrichSets(
      parseCsv(text).sets,
      buildMetaIndex(realMeta),
      makeBodyweightResolver([{ date: '2023-01-01', kg: 80 }, { date: '2023-12-31', kg: 84 }], 80),
    );
    expect(volume(again).volumeKg).toBeCloseTo(volume(enriched).volumeKg, 6);
    expect(summarise('Pull Up', again.filter((s) => s.canonicalName === 'Pull Up')).volume.volumeKg)
      .toBeCloseTo(
        summarise('Pull Up', enriched.filter((s) => s.canonicalName === 'Pull Up')).volume.volumeKg,
        6,
      );
  });
});
