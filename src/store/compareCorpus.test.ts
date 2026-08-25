import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearCompareCorpus,
  getCompareCorpus,
  loadCompareCorpus,
  patchCompareCorpus,
  subscribeCompareCorpus,
  type CompareCorpus,
} from './compareCorpus';

/**
 * The store exists so the other person's export survives a tab switch, since App
 * unmounts the Compare view whenever you navigate away.
 */

const CORPUS: CompareCorpus = {
  filename: 'theirs.csv',
  text: 'Datum,Gewicht',
  label: 'Alex',
  bodyweightInput: '78',
  scale: 'absolute',
};

beforeEach(() => clearCompareCorpus());

describe('compare corpus store', () => {
  it('starts empty', () => {
    expect(getCompareCorpus()).toBeNull();
  });

  it('holds a loaded corpus', () => {
    loadCompareCorpus(CORPUS);
    expect(getCompareCorpus()).toEqual(CORPUS);
  });

  it('patches the fields around the file without disturbing it', () => {
    loadCompareCorpus(CORPUS);
    patchCompareCorpus({ label: 'Sam', scale: 'relative' });
    const c = getCompareCorpus();
    expect(c?.label).toBe('Sam');
    expect(c?.scale).toBe('relative');
    // The file and the bodyweight are untouched.
    expect(c?.text).toBe(CORPUS.text);
    expect(c?.filename).toBe(CORPUS.filename);
    expect(c?.bodyweightInput).toBe('78');
  });

  /** A stray edit must not conjure a corpus that has no CSV behind it. */
  it('ignores a patch when nothing is loaded', () => {
    patchCompareCorpus({ label: 'Ghost' });
    expect(getCompareCorpus()).toBeNull();
  });

  it('replaces wholesale when a new file is dropped', () => {
    loadCompareCorpus(CORPUS);
    patchCompareCorpus({ label: 'Sam' });
    loadCompareCorpus({ ...CORPUS, filename: 'other.csv', label: 'Them' });
    // The previous person's name does not linger on the new file.
    expect(getCompareCorpus()?.label).toBe('Them');
    expect(getCompareCorpus()?.filename).toBe('other.csv');
  });

  it('clears', () => {
    loadCompareCorpus(CORPUS);
    clearCompareCorpus();
    expect(getCompareCorpus()).toBeNull();
  });

  it('notifies subscribers on every change, and stops after unsubscribe', () => {
    let calls = 0;
    const unsub = subscribeCompareCorpus(() => {
      calls++;
    });

    loadCompareCorpus(CORPUS);
    patchCompareCorpus({ label: 'Sam' });
    clearCompareCorpus();
    expect(calls).toBe(3);

    unsub();
    loadCompareCorpus(CORPUS);
    expect(calls).toBe(3);
  });
});
