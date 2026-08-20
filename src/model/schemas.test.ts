import { describe, it, expect } from 'vitest';
import {
  readBodyweight,
  readMetaMap,
  readRawArchive,
  readRawImport,
  readSettings,
  type ValidationWarning,
} from './schemas';
import { DEFAULT_SETTINGS } from './types';
import { meta } from '../test/helpers';

/**
 * Anything read out of IndexedDB must degrade to a sensible default and surface a
 * warning. Nothing here may throw: a corrupt value must never white-screen the app.
 */

function warns() {
  return [] as ValidationWarning[];
}

describe('settings', () => {
  it('round-trips a valid value', () => {
    const w = warns();
    const s = readSettings(
      { inputUnit: 'lb', displayUnit: 'kg', weekStartsOn: 0, defaultBodyweightKg: 72 },
      w,
    );
    expect(s.inputUnit).toBe('lb');
    expect(s.weekStartsOn).toBe(0);
    expect(w).toEqual([]);
  });

  it('returns defaults for absent data without warning', () => {
    const w = warns();
    expect(readSettings(undefined, w)).toEqual(DEFAULT_SETTINGS);
    expect(w).toEqual([]);
  });

  it('falls back and warns on garbage', () => {
    const w = warns();
    expect(readSettings('not an object', w)).toEqual(DEFAULT_SETTINGS);
    expect(readSettings({ inputUnit: 'stones' }, w)).toEqual(DEFAULT_SETTINGS);
    expect(w.length).toBeGreaterThan(0);
  });

  it('fills in missing fields from defaults', () => {
    const w = warns();
    const s = readSettings({ inputUnit: 'lb' }, w);
    expect(s.inputUnit).toBe('lb');
    expect(s.displayUnit).toBe('kg');
    expect(s.defaultBodyweightKg).toBe(80);
  });

  it('ignores unknown future fields rather than rejecting the record', () => {
    const w = warns();
    const s = readSettings({ ...DEFAULT_SETTINGS, futureFlag: true }, w);
    expect(s).toEqual(DEFAULT_SETTINGS);
    expect(w).toEqual([]);
  });
});

describe('exercise metadata', () => {
  it('keeps good entries and drops only the corrupt ones', () => {
    const w = warns();
    const out = readMetaMap(
      {
        Good: meta('Good'),
        Bad: { name: 'Bad', loadType: 'telekinesis' },
        AlsoGood: meta('AlsoGood', { confirmed: true }),
      },
      w,
    );
    expect(Object.keys(out).sort()).toEqual(['AlsoGood', 'Good']);
    expect(w).toHaveLength(1);
    expect(w[0]?.message).toContain('1 entry');
  });

  it('degrades an entirely wrong shape to empty', () => {
    const w = warns();
    expect(readMetaMap(['nope'], w)).toEqual({});
    expect(w).toHaveLength(1);
  });

  it('treats absent metadata as empty without warning', () => {
    const w = warns();
    expect(readMetaMap(undefined, w)).toEqual({});
    expect(w).toEqual([]);
  });
});

describe('bodyweight', () => {
  it('keeps valid rows and drops malformed ones', () => {
    const w = warns();
    const out = readBodyweight(
      [
        { date: '2024-01-01', kg: 80 },
        { date: '01/01/2024', kg: 80 },
        { date: '2024-02-01', kg: -5 },
        { date: '2024-03-01', kg: 81.5 },
      ],
      w,
    );
    expect(out).toEqual([
      { date: '2024-01-01', kg: 80 },
      { date: '2024-03-01', kg: 81.5 },
    ]);
    expect(w[0]?.message).toContain('2 entries');
  });

  it('degrades a non-array to empty', () => {
    const w = warns();
    expect(readBodyweight({ date: '2024-01-01' }, w)).toEqual([]);
    expect(w).toHaveLength(1);
  });
});

describe('raw imports', () => {
  it('reads a stored import and defaults a missing unit', () => {
    const w = warns();
    const r = readRawImport(
      'raw:current',
      { text: 'a,b', importedAt: 1, filename: 'x.csv' },
      w,
    );
    expect(r?.unit).toBe('kg');
    expect(w).toEqual([]);
  });

  it('degrades a corrupt import to null and warns', () => {
    const w = warns();
    expect(readRawImport('raw:current', { text: 42 }, w)).toBeNull();
    expect(w).toHaveLength(1);
  });

  it('keeps only the readable entries of the archive', () => {
    const w = warns();
    const out = readRawArchive(
      [
        { text: 'a', importedAt: 1, filename: 'a.csv', unit: 'kg' },
        { garbage: true },
        { text: 'b', importedAt: 2, filename: 'b.csv', unit: 'lb' },
      ],
      w,
    );
    expect(out).toHaveLength(2);
    expect(out[1]?.unit).toBe('lb');
  });
});

describe('no read ever throws', () => {
  const nasties: unknown[] = [
    undefined,
    null,
    0,
    '',
    'string',
    [],
    {},
    { __proto__: null },
    [1, 2, 3],
    { nested: { deeply: { wrong: true } } },
  ];

  it('survives every hostile value on every key', () => {
    for (const v of nasties) {
      expect(() => readSettings(v, warns())).not.toThrow();
      expect(() => readMetaMap(v, warns())).not.toThrow();
      expect(() => readBodyweight(v, warns())).not.toThrow();
      expect(() => readRawImport('raw:current', v, warns())).not.toThrow();
      expect(() => readRawArchive(v, warns())).not.toThrow();
    }
  });
});
