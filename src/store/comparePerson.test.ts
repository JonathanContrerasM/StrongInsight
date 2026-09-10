import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCompareImport,
  clearComparePerson,
  getComparePerson,
  hydrateComparePerson,
  labelFromFilename,
  patchComparePerson,
  setCompareImport,
  subscribeComparePerson,
} from './comparePerson';
import type { ComparePerson, RawImport } from '../model/types';

/**
 * The store exists so the other person survives a tab switch -- App unmounts the
 * Compare view whenever you navigate away -- and now a reload as well.
 *
 * These run in Node, where `saveComparePerson` finds no IndexedDB and degrades
 * silently, so what is asserted here is the in-memory contract. `hydrate` is
 * used to reset between tests precisely because it does NOT schedule a write.
 */

const RAW: RawImport = {
  text: 'Datum,Übung\n',
  importedAt: 1_700_000_000_000,
  filename: 'alex_strong.csv',
  unit: 'kg',
};

beforeEach(() => {
  clearComparePerson();
  hydrateComparePerson(null);
});

describe('compare person store', () => {
  it('starts empty', () => {
    expect(getComparePerson()).toBeNull();
  });

  /**
   * The reversal from the old store: you can name and weigh someone before their
   * export exists, because in practice the CSV has to be asked for.
   */
  it('seeds a person from a patch when nothing is loaded', () => {
    patchComparePerson({ label: 'Sam' });
    expect(getComparePerson()).toEqual({
      label: 'Sam',
      scale: 'absolute',
      bodyweight: [],
      import: null,
    });
  });

  it('keeps the name and the weights when a new file is dropped', () => {
    patchComparePerson({ label: 'Sam', bodyweight: [{ date: '2025-01-02', kg: 78 }] });
    setCompareImport(RAW);
    const p = getComparePerson() as ComparePerson;
    // A fresher export from the same person must not wipe what was typed.
    expect(p.label).toBe('Sam');
    expect(p.bodyweight).toEqual([{ date: '2025-01-02', kg: 78 }]);
    expect(p.import?.filename).toBe('alex_strong.csv');
  });

  it('seeds the name from the filename only when it is still blank', () => {
    setCompareImport(RAW);
    expect(getComparePerson()?.label).toBe('Alex');

    patchComparePerson({ label: 'Sam' });
    setCompareImport({ ...RAW, filename: 'jordan.csv' });
    expect(getComparePerson()?.label).toBe('Sam');
  });

  it('removes the export without forgetting the person', () => {
    patchComparePerson({ label: 'Sam', bodyweight: [{ date: '2025-01-02', kg: 78 }] });
    setCompareImport(RAW);
    clearCompareImport();
    const p = getComparePerson() as ComparePerson;
    expect(p.import).toBeNull();
    expect(p.label).toBe('Sam');
    expect(p.bodyweight).toHaveLength(1);
  });

  it('forgets them entirely', () => {
    setCompareImport(RAW);
    clearComparePerson();
    expect(getComparePerson()).toBeNull();
  });

  it('hydrates once, and never clobbers what is already there', () => {
    const stored: ComparePerson = {
      label: 'Alex',
      scale: 'relative',
      bodyweight: [{ date: '2025-03-01', kg: 80 }],
      import: RAW,
    };
    hydrateComparePerson(stored);
    expect(getComparePerson()).toEqual(stored);

    // StrictMode double-invokes the hydration effect; a slow read must not win
    // over something the user has already typed.
    hydrateComparePerson({ ...stored, label: 'Someone else' });
    expect(getComparePerson()?.label).toBe('Alex');
  });

  it('notifies subscribers on every change, and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeComparePerson(() => {
      calls++;
    });

    setCompareImport(RAW);
    patchComparePerson({ label: 'Sam' });
    clearComparePerson();
    expect(calls).toBe(3);

    unsub();
    setCompareImport(RAW);
    expect(calls).toBe(3);
  });
});

describe('labelFromFilename', () => {
  it('recovers a name from the usual export filenames', () => {
    expect(labelFromFilename('alex_strong_2025.csv')).toBe('Alex');
    expect(labelFromFilename('Jordan-workouts-2025-08-14.csv')).toBe('Jordan');
    expect(labelFromFilename('sam mcallister.csv')).toBe('Sam Mcallister');
    expect(labelFromFilename('theirs (1).csv')).toBe('Theirs');
  });

  /** '' rather than an invention, so the placeholder shows through instead. */
  it('gives up on a filename that is all noise', () => {
    expect(labelFromFilename('strong.csv')).toBe('');
    expect(labelFromFilename('workouts_20250814.csv')).toBe('');
    expect(labelFromFilename('')).toBe('');
  });
});
