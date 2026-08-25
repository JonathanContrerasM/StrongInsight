import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBodyweightCsv } from './parseBodyweightCsv';
import { parseCsv } from './parseCsv';
import { HeaderMappingError } from './headerMap';
import { makeBodyweightCsv } from '../test/helpers';
import {
  REAL_FIXTURE,
  REAL_WEIGHT_FIXTURE,
  SAMPLE_WEIGHT_FIXTURE,
  hasRealFixture,
  hasRealWeightFixture,
} from '../test/fixtures';

/**
 * The measurements export is the messiest input this app takes: a decade of Apple
 * Health writes, several measurement kinds, junk zeros, and multiple readings on
 * one day against a model that stores one weight per day.
 *
 * Every stage of that funnel gets a test, because a silent miscount here does not
 * throw -- it just quietly shifts the effective load of every bodyweight set.
 */

/** A generous span, so tests that are not about clipping are not clipped. */
const WIDE = { from: new Date(2000, 0, 1), to: new Date(2030, 0, 1) };

const reasons = (r: { rejected: Array<{ reason: string }> }) => r.rejected.map((x) => x.reason);

describe('parseBodyweightCsv', () => {
  it('reads the German export shape', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 80 },
      { date: '2023-03-08 08:00:00', value: 81.5 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries).toEqual([
      { date: '2023-03-01', kg: 80 },
      { date: '2023-03-08', kg: 81.5 },
    ]);
    expect(report.rowsRead).toBe(2);
    expect(report.entriesKept).toBe(2);
    expect(report.headersUnrecognised).toEqual([]);
    expect(report.dateRange).toEqual({ from: '2023-03-01', to: '2023-03-08' });
  });

  it('throws rather than guessing when the headers are not a measurements export', () => {
    expect(() => parseBodyweightCsv('a,b,c\r\n1,2,3')).toThrow(HeaderMappingError);
  });

  it('returns an empty result for empty input instead of throwing', () => {
    expect(parseBodyweightCsv('').entries).toEqual([]);
    expect(parseBodyweightCsv('   \r\n').entries).toEqual([]);
  });

  // --- integrity ---------------------------------------------------------------

  it('rejects the zeros health apps write, and says which line they were on', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 80 },
      { date: '2023-03-02 08:00:00', value: 0 },
      { date: '2023-03-03 08:00:00', value: 81 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries.map((e) => e.date)).toEqual(['2023-03-01', '2023-03-03']);
    expect(report.rejected).toEqual([{ line: 3, raw: '0', reason: 'implausible' }]);
  });

  it('holds the plausibility band at its lower edge', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 29.9 },
      { date: '2023-03-02 08:00:00', value: 30 },
      { date: '2023-03-03 08:00:00', value: 31 },
      { date: '2023-03-04 08:00:00', value: 30.5 },
    ]);
    const { entries } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries.map((e) => e.kg)).toContain(30);
    expect(entries.map((e) => e.kg)).not.toContain(29.9);
  });

  it('holds the plausibility band at its upper edge', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 300.1 },
      { date: '2023-03-02 08:00:00', value: 300 },
      { date: '2023-03-03 08:00:00', value: 295 },
      { date: '2023-03-04 08:00:00', value: 298 },
    ]);
    const { entries } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries.map((e) => e.kg)).toContain(300);
    expect(entries.map((e) => e.kg)).not.toContain(300.1);
  });

  it('does not judge outliers below three readings', () => {
    // The median of two far-apart values sits between them and would cull both.
    // With no centre worth trusting, the user keeps their data.
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 60 },
      { date: '2023-03-02 08:00:00', value: 120 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries.map((e) => e.kg)).toEqual([60, 120]);
    expect(reasons(report)).not.toContain('outlier');
  });

  it('drops a value far from the median and reports it as an outlier', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 80 },
      { date: '2023-03-02 08:00:00', value: 81 },
      { date: '2023-03-03 08:00:00', value: 180 },
      { date: '2023-03-04 08:00:00', value: 80.5 },
      { date: '2023-03-05 08:00:00', value: 79 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries.map((e) => e.kg)).not.toContain(180);
    expect(entries).toHaveLength(4);
    expect(report.rejected).toContainEqual({ line: 4, raw: '180', reason: 'outlier' });
  });

  it('leaves an ordinary bodyweight swing alone', () => {
    // 6 kg of drift is a real cut, not a broken scale.
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 86 },
      { date: '2023-04-01 08:00:00', value: 83 },
      { date: '2023-05-01 08:00:00', value: 80 },
    ]);
    const { entries } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries).toHaveLength(3);
  });

  it('reports an unreadable date rather than dropping the row in silence', () => {
    const csv = makeBodyweightCsv([
      { date: 'not-a-date', value: 80 },
      { date: '2023-03-02 08:00:00', value: 81 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries).toHaveLength(1);
    expect(reasons(report)).toEqual(['bad-date']);
  });

  // --- one entry per day -------------------------------------------------------

  it('keeps the last reading of a day and counts what it collapsed', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 07:40:11', value: 82 },
      { date: '2023-03-01 21:15:02', value: 85 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries).toEqual([{ date: '2023-03-01', kg: 85 }]);
    expect(report.sameDayCollapsed).toBe(1);
  });

  it('collapses an identical timestamp logged by two sources', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 18:51:23', value: 86, source: 'Apple Health' },
      { date: '2023-03-01 18:51:23', value: 86, source: 'Strong' },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries).toEqual([{ date: '2023-03-01', kg: 86 }]);
    expect(report.sameDayCollapsed).toBe(1);
  });

  // --- clipping to the training period -----------------------------------------

  it('clips readings to the workout span', () => {
    const csv = makeBodyweightCsv([
      { date: '2016-09-27 22:12:20', value: 68.5 },
      { date: '2023-03-01 08:00:00', value: 80 },
      { date: '2029-01-01 08:00:00', value: 81 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, {
      span: { from: new Date(2023, 0, 1), to: new Date(2023, 11, 31) },
    });

    expect(entries.map((e) => e.date)).toEqual(['2023-03-01']);
    expect(report.outOfSpan).toBe(2);
  });

  it('counts a reading later on the final training day as inside the span', () => {
    const csv = makeBodyweightCsv([{ date: '2023-06-30 22:45:00', value: 80 }]);
    const { entries, report } = parseBodyweightCsv(csv, {
      span: { from: new Date(2023, 0, 1), to: new Date(2023, 5, 30, 9, 0, 0) },
    });
    expect(entries).toHaveLength(1);
    expect(report.outOfSpan).toBe(0);
  });

  it('keeps everything when no span is supplied', () => {
    const csv = makeBodyweightCsv([
      { date: '2016-09-27 22:12:20', value: 80 },
      { date: '2023-03-01 08:00:00', value: 81 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, {});
    expect(entries).toHaveLength(2);
    expect(report.outOfSpan).toBe(0);
  });

  // --- measurement kinds -------------------------------------------------------

  it('takes only the weight rows and reports the kinds it skipped', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', type: 'Gewicht', value: 80 },
      { date: '2023-03-02 08:00:00', type: 'Koerperfett', value: 18.2, unit: '%' },
      { date: '2023-03-03 08:00:00', type: 'Koerperfett', value: 18.4, unit: '%' },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries).toHaveLength(1);
    expect(report.skippedTypes).toEqual([{ type: 'Koerperfett', count: 2 }]);
    // A different measurement is not a broken weight.
    expect(reasons(report)).not.toContain('unknown-unit');
    expect(reasons(report)).not.toContain('implausible');
  });

  it('accepts an unknown kind when it is the only one and reads as a mass', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', type: 'Kroppsvikt', value: 80 },
      { date: '2023-03-02 08:00:00', type: 'Kroppsvikt', value: 81 },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries).toHaveLength(2);
    expect(report.assumedSingleType).toBe(true);
    expect(report.skippedTypes).toEqual([]);
  });

  it('does not guess when the only unknown kind is not a mass', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', type: 'Umfang Brust', value: 102, unit: 'cm' },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries).toEqual([]);
    expect(report.assumedSingleType).toBe(false);
    expect(report.skippedTypes).toEqual([{ type: 'Umfang Brust', count: 1 }]);
  });

  it('treats every row as a weight when the file has no measurement-type column', () => {
    const csv = ['Datum,Gewicht', '2023-03-01,80', '2023-03-08,81'].join('\r\n');
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });

    expect(report.noTypeColumn).toBe(true);
    expect(entries).toEqual([
      { date: '2023-03-01', kg: 80 },
      { date: '2023-03-08', kg: 81 },
    ]);
  });

  // --- units -------------------------------------------------------------------

  it('converts each row by its own unit cell', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 176.37, unit: 'lbs' },
      { date: '2023-03-08 08:00:00', value: 80, unit: 'kg' },
    ]);
    const { entries } = parseBodyweightCsv(csv, { span: WIDE });

    expect(entries[0]?.kg).toBeCloseTo(80, 1);
    expect(entries[1]?.kg).toBe(80);
  });

  it('falls back to the caller unit when no unit column exists', () => {
    const csv = ['Datum,Gewicht', '2023-03-01,176.37'].join('\r\n');
    const { entries } = parseBodyweightCsv(csv, { span: WIDE, unit: 'lb' });
    expect(entries[0]?.kg).toBeCloseTo(80, 1);
  });

  it('reads a unit suffix on the value header', () => {
    const csv = ['Datum,Gewicht (lbs)', '2023-03-01,176.37'].join('\r\n');
    const { entries } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries[0]?.kg).toBeCloseTo(80, 1);
  });

  it('refuses a unit it does not understand rather than assuming kg', () => {
    const csv = makeBodyweightCsv([
      { date: '2023-03-01 08:00:00', value: 80, unit: 'stone' },
      { date: '2023-03-02 08:00:00', value: 80, unit: 'kg' },
    ]);
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });
    expect(entries).toHaveLength(1);
    expect(reasons(report)).toEqual(['unknown-unit']);
  });

  it('tolerates a decimal comma', () => {
    // A comma-decimal locale delimits with semicolons -- otherwise the decimal
    // separator and the field separator are the same character.
    const csv = makeBodyweightCsv([{ date: '2023-03-01 08:00:00', value: '80,4' }], {
      delimiter: ';',
    });
    expect(parseBodyweightCsv(csv, { span: WIDE }).entries[0]?.kg).toBe(80.4);
  });

  it('reads a semicolon-delimited export', () => {
    const csv = makeBodyweightCsv([{ date: '2023-03-01 08:00:00', value: 80 }], {
      delimiter: ';',
    });
    const { entries, report } = parseBodyweightCsv(csv, { span: WIDE });
    expect(report.delimiter).toBe(';');
    expect(entries).toHaveLength(1);
  });
});

/**
 * The committed sample is deterministic. These numbers are measured from it, so
 * regenerating the fixture without updating them should fail loudly.
 *
 * It is built to sit against `sample_workouts.csv`, whose span is
 * 2023-01-09 -> 2023-05-19.
 */
describe('sample_weight.csv', () => {
  const text = readFileSync(SAMPLE_WEIGHT_FIXTURE, 'utf8');
  const SPAN = { from: new Date(2023, 0, 9), to: new Date(2023, 4, 19) };
  const { entries, report } = parseBodyweightCsv(text, {
    filename: 'sample_weight.csv',
    span: SPAN,
  });

  it('is stored the way Strong writes it', () => {
    expect(text.includes('\r\n')).toBe(true);
    expect(text.startsWith('﻿')).toBe(false);
    expect(text.endsWith('\n')).toBe(false);
  });

  it('funnels 10 rows down to 3 entries', () => {
    expect(report.rowsRead).toBe(10);
    expect(report.entriesKept).toBe(3);
    expect(entries).toEqual([
      { date: '2023-01-09', kg: 78.5 },
      { date: '2023-03-11', kg: 79 },
      // The later of the two 2023-05-19 readings.
      { date: '2023-05-19', kg: 81.2 },
    ]);
  });

  it('accounts for every row it did not keep', () => {
    expect(report.skippedTypes).toEqual([{ type: 'Koerperfett', count: 1 }]);
    expect(report.outOfSpan).toBe(3);
    expect(report.sameDayCollapsed).toBe(2);
    expect(reasons(report)).toEqual(['implausible']);
  });
});

/**
 * The real measurements export, measured not specified.
 *
 * Both personal exports are gitignored, so this SKIPS on a fresh clone rather
 * than failing -- a skipped test is visible in the runner output, a deleted one
 * is not. It needs the workout export too, because the span is what clips it.
 */
const real = hasRealFixture() && hasRealWeightFixture();

// Read eagerly but only when present: `describe.skipIf` still evaluates the
// describe body to collect its tests, so a read inside it would throw ENOENT on
// a clone that has neither export.
const parsedReal = real
  ? parseBodyweightCsv(readFileSync(REAL_WEIGHT_FIXTURE, 'utf8'), {
      filename: 'strong_weight.csv',
      span: parseCsv(readFileSync(REAL_FIXTURE, 'utf8')).report.dateRange,
    })
  : null;

describe.skipIf(!real)('strong_weight.csv', () => {
  const { entries, report } = parsedReal ?? { entries: [], report: null! };

  it('keeps only the readings that overlap the training history', () => {
    expect(report.rowsRead).toBe(23);
    expect(report.entriesKept).toBe(10);
    expect(entries.map((e) => e.date)).toEqual([
      '2024-09-12',
      '2024-11-28',
      '2025-04-28',
      '2025-05-01',
      '2025-05-04',
      '2025-10-01',
      '2025-11-16',
      '2026-01-19',
      '2026-04-24',
      '2026-05-29',
    ]);
  });

  it('resolves the two readings six seconds apart to the later one', () => {
    // 2026-01-19 carries 82 kg at 14:29:50 and 85 kg at 14:29:56.
    expect(entries.find((e) => e.date === '2026-01-19')?.kg).toBe(85);
  });

  it('refuses the three zeros Apple Health wrote in 2019', () => {
    expect(report.rejected).toEqual([
      { line: 19, raw: '0', reason: 'implausible' },
      { line: 20, raw: '0', reason: 'implausible' },
      { line: 21, raw: '0', reason: 'implausible' },
    ]);
  });

  it('accounts for the pre-training decade rather than losing it quietly', () => {
    expect(report.outOfSpan).toBe(8);
    expect(report.sameDayCollapsed).toBe(2);
    expect(report.skippedTypes).toEqual([]);
  });
});
