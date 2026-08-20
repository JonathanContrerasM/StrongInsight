import { describe, it, expect } from 'vitest';
import { sniffDelimiter } from './sniffDelimiter';
import { mapHeaders, HeaderMappingError, normalizeHeader } from './headerMap';
import { classifyRow } from './classifyRow';
import { parseDuration } from './parseDuration';
import { parseCsv } from './parseCsv';
import {
  ENGLISH_HEADERS,
  GERMAN_HEADERS,
  makeCsv,
} from '../test/helpers';

describe('sniffDelimiter', () => {
  it('detects comma, semicolon and tab', () => {
    for (const d of [',', ';', '\t']) {
      const csv = makeCsv([{ exercise: 'Squat (Barbell)' }, { exercise: 'Squat (Barbell)', setOrder: 2 }], {
        delimiter: d,
      });
      const r = sniffDelimiter(csv);
      expect(r.delimiter, 'delimiter ' + JSON.stringify(d)).toBe(d);
      expect(r.fieldCount).toBe(12);
      expect(r.confident).toBe(true);
    }
  });

  it('is not fooled by commas inside quoted fields when the delimiter is a semicolon', () => {
    const csv = makeCsv([{ exercise: 'Row, Seated (Cable)', notes: 'a, b, c' }], { delimiter: ';' });
    expect(sniffDelimiter(csv).delimiter).toBe(';');
  });

  it('falls back to comma on unusable input', () => {
    expect(sniffDelimiter('').delimiter).toBe(',');
    expect(sniffDelimiter('single-column').delimiter).toBe(',');
  });
});

describe('header mapping', () => {
  it('maps German headers', () => {
    const m = mapHeaders(GERMAN_HEADERS.split(','));
    expect(m.index.date).toBe(0);
    expect(m.index.exerciseName).toBe(3);
    expect(m.index.setOrder).toBe(4);
    expect(m.index.weight).toBe(5);
    expect(m.index.reps).toBe(6);
    expect(m.index.rpe).toBe(11);
    expect(m.unrecognised).toEqual([]);
  });

  it('maps English headers to the same columns', () => {
    const de = mapHeaders(GERMAN_HEADERS.split(','));
    const en = mapHeaders(ENGLISH_HEADERS.split(','));
    expect(en.index).toEqual(de.index);
  });

  it('parses a unit suffix from the weight header when present', () => {
    expect(mapHeaders(GERMAN_HEADERS.replace('Gewicht', 'Gewicht (kg)').split(',')).weightUnitFromHeader).toBe('kg');
    expect(mapHeaders(ENGLISH_HEADERS.replace('Weight', 'Weight (lbs)').split(',')).weightUnitFromHeader).toBe('lb');
    expect(mapHeaders(GERMAN_HEADERS.split(',')).weightUnitFromHeader).toBeNull();
  });

  it('folds diacritics and punctuation when matching', () => {
    expect(normalizeHeader('Name der Übung')).toBe('namederubung');
    expect(normalizeHeader('Wiederh.')).toBe('wiederh');
    expect(normalizeHeader('Workout-Name')).toBe('workoutname');
  });

  it('fails loudly and names the columns it could not find', () => {
    const bad = ['alpha', 'beta', 'gamma'];
    let err: unknown;
    try {
      mapHeaders(bad);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(HeaderMappingError);
    const e = err as HeaderMappingError;
    expect(e.missing).toContain('date');
    expect(e.message).toContain('alpha');
  });
});

describe('parseDuration', () => {
  it('parses the documented Strong formats', () => {
    expect(parseDuration('1h 5min')).toBe(3900);
    expect(parseDuration('54min')).toBe(3240);
    expect(parseDuration('1h')).toBe(3600);
  });

  it('handles variants and junk', () => {
    expect(parseDuration('1h 3m')).toBe(3780);
    expect(parseDuration('45m')).toBe(2700);
    expect(parseDuration('1:05:00')).toBe(3900);
    expect(parseDuration('90')).toBe(5400);
    expect(parseDuration('')).toBeNull();
    expect(parseDuration(null)).toBeNull();
    expect(parseDuration('not a duration')).toBeNull();
  });
});

describe('classifyRow', () => {
  const bare = { weight: null, reps: null, seconds: null };

  it('classifies numeric set orders as working sets', () => {
    expect(classifyRow({ ...bare, setOrder: '1' })).toEqual({ kind: 'set', order: 1 });
    expect(classifyRow({ ...bare, setOrder: '27' })).toEqual({ kind: 'set', order: 27 });
  });

  it('classifies W and D', () => {
    expect(classifyRow({ ...bare, setOrder: 'W' }).kind).toBe('warmup');
    expect(classifyRow({ ...bare, setOrder: 'D' }).kind).toBe('dropset');
  });

  it('classifies localised rest tokens', () => {
    expect(classifyRow({ ...bare, setOrder: 'Ruhezeit', seconds: 120 })).toEqual({
      kind: 'rest',
      sec: 120,
    });
    expect(classifyRow({ ...bare, setOrder: 'Rest Timer', seconds: 90 }).kind).toBe('rest');
  });

  it('reports anything else as unknown rather than dropping it', () => {
    const r = classifyRow({ ...bare, setOrder: 'F' });
    expect(r).toEqual({ kind: 'unknown', raw: 'F' });
  });

  /**
   * Regression guard for the single most dangerous ordering in the parser.
   * An isometric hold is byte-identical to a rest row except for its set order.
   */
  it('does NOT swallow an isometric hold as a rest row', () => {
    const hold = { setOrder: '1', weight: 0, reps: 0, seconds: 60 };
    expect(classifyRow(hold)).toEqual({ kind: 'set', order: 1 });
  });

  it('still uses the structural test for a rest row in an unknown language', () => {
    const r = classifyRow({ setOrder: 'Vilotid', weight: 0, reps: 0, seconds: 120 });
    expect(r).toEqual({ kind: 'rest', sec: 120 });
  });
});

describe('parseCsv structure', () => {
  it('collapses a rest row onto the preceding set and never emits it as a set', () => {
    const csv = makeCsv([
      { exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      { exercise: 'Squat (Barbell)', setOrder: 'Ruhezeit', seconds: 120 },
      { exercise: 'Squat (Barbell)', setOrder: 2, weight: 100, reps: 5 },
    ]);
    const { sets } = parseCsv(csv);
    expect(sets).toHaveLength(2);
    expect(sets[0]?.restAfterSec).toBe(120);
    expect(sets[1]?.restAfterSec).toBeNull();
  });

  it('never attaches rest backwards across an exercise or workout boundary', () => {
    const csv = makeCsv([
      { exercise: 'Squat (Barbell)', setOrder: 1, weight: 100, reps: 5 },
      // rest is the first row of a different exercise: must be dropped, not attached
      { exercise: 'Bench Press (Barbell)', setOrder: 'Ruhezeit', seconds: 120 },
      { exercise: 'Bench Press (Barbell)', setOrder: 1, weight: 80, reps: 5 },
    ]);
    const { sets, report } = parseCsv(csv);
    expect(report.orphanRestRows).toBe(1);
    expect(sets[0]?.restAfterSec).toBeNull();
    expect(sets).toHaveLength(2);
  });

  it('takes the last value when rest rows repeat, and counts the overwrite', () => {
    const csv = makeCsv([
      { setOrder: 1, weight: 100, reps: 5 },
      { setOrder: 'Ruhezeit', seconds: 90 },
      { setOrder: 'Ruhezeit', seconds: 120 },
    ]);
    const { sets, report } = parseCsv(csv);
    expect(sets[0]?.restAfterSec).toBe(120);
    expect(report.duplicateRestRows).toBe(1);
  });

  it('numbers set order densely per exercise, counting warm-ups', () => {
    const csv = makeCsv([
      { exercise: 'Bench Press (Barbell)', setOrder: 'W', weight: 20, reps: 10 },
      { exercise: 'Bench Press (Barbell)', setOrder: 'W', weight: 40, reps: 8 },
      { exercise: 'Bench Press (Barbell)', setOrder: 1, weight: 80, reps: 5 },
      { exercise: 'Bench Press (Barbell)', setOrder: 'D', weight: 60, reps: 8 },
    ]);
    const { sets } = parseCsv(csv);
    expect(sets.map((s) => s.setOrder)).toEqual([1, 2, 3, 4]);
    expect(sets.map((s) => s.setKind)).toEqual(['warmup', 'warmup', 'working', 'dropset']);
  });

  it('reports unknown tokens with their file line rather than dropping them', () => {
    const csv = makeCsv([
      { setOrder: 1, weight: 100, reps: 5 },
      { setOrder: 'F', weight: 100, reps: 5 },
    ]);
    const { sets, report } = parseCsv(csv);
    expect(sets).toHaveLength(1);
    expect(report.unknownTokens).toEqual([
      { raw: 'F', line: 3, exerciseName: 'Squat (Barbell)' },
    ]);
  });

  it('groups workouts by (date, name) and keeps duration off the set', () => {
    const csv = makeCsv([
      { date: '2024-01-01 10:00:00', workout: 'Morgen-Workout', duration: '1h 5min', setOrder: 1, weight: 100, reps: 5 },
      { date: '2024-01-01 10:00:00', workout: 'Morgen-Workout', duration: '1h 5min', setOrder: 2, weight: 100, reps: 5 },
      { date: '2024-01-01 18:00:00', workout: 'Abend-Workout', duration: '54min', setOrder: 1, weight: 100, reps: 5 },
    ]);
    const { workouts } = parseCsv(csv);
    expect(workouts).toHaveLength(2);
    expect(workouts[0]?.durationSec).toBe(3900);
    expect(workouts[1]?.durationSec).toBe(3240);
    expect(workouts[0]?.setIds).toHaveLength(2);
  });

  it('converts pounds to kilograms when the header says so', () => {
    const csv = makeCsv([{ setOrder: 1, weight: 100, reps: 5 }], {
      headers: ENGLISH_HEADERS.replace('Weight', 'Weight (lbs)'),
    });
    const { sets, report } = parseCsv(csv);
    expect(report.unit).toBe('lb');
    expect(report.unitSource).toBe('header');
    expect(sets[0]?.weightKg).toBeCloseTo(45.359237, 4);
  });

  it('parses a file with no trailing newline', () => {
    const csv = makeCsv([{ setOrder: 1, weight: 100, reps: 5 }], { trailingNewline: false });
    expect(parseCsv(csv).sets).toHaveLength(1);
  });

  it('parses dates as local wall-clock time, not UTC', () => {
    const csv = makeCsv([{ date: '2024-09-10 18:36:38', setOrder: 1, weight: 100, reps: 5 }]);
    const d = parseCsv(csv).sets[0]?.date;
    expect(d?.getFullYear()).toBe(2024);
    expect(d?.getMonth()).toBe(8);
    expect(d?.getDate()).toBe(10);
    expect(d?.getHours()).toBe(18);
  });

  it('trims stray whitespace from exercise names and reports it', () => {
    const csv = makeCsv([{ exercise: 'Single Leg Extension ', setOrder: 1, weight: 20, reps: 10 }]);
    const { sets, report } = parseCsv(csv);
    expect(sets[0]?.exerciseName).toBe('Single Leg Extension');
    expect(report.trimmedNames).toEqual(['Single Leg Extension ']);
  });

  it('flags a collision when trimming merges two distinct raw names', () => {
    const csv = makeCsv([
      { exercise: 'Row Ring', setOrder: 1, weight: 0, reps: 10 },
      { exercise: 'Row Ring ', setOrder: 2, weight: 0, reps: 10 },
    ]);
    expect(parseCsv(csv).report.nameCollisions).toEqual(['Row Ring']);
  });
});
