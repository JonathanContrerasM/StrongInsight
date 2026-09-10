import { useSyncExternalStore } from 'react';
import { saveComparePerson } from './idb';
import type { ComparePerson, CompareScale, RawImport } from '../model/types';

/**
 * The other person on the Compare tab.
 *
 * A module-level store rather than component state, because App renders views as
 * `{activeTab === 'compare' && <Compare />}` -- leaving the tab unmounts the
 * component, and with the file in component state that meant re-dropping the CSV
 * every time you glanced at the dashboard. Same shape as `ui/theme.ts`, for the
 * same reason: state that has to outlive one component's mount without being
 * threaded through a parent that does not otherwise care about it.
 *
 * It IS persisted, to `compare:person` in IndexedDB. That is a reversal of what
 * this file used to do and it is worth being explicit about, because what is
 * being written is somebody else's training history:
 *
 *   - It never leaves the device. There is not a network call anywhere in `src/`,
 *     and `src/network.test.ts` fails the build if one appears.
 *   - Both "Forget" on the Compare tab and "Reset everything" in Settings delete
 *     the key outright, not just the in-memory copy.
 *   - The tab says so where the file is dropped, rather than only in a doc.
 *
 * The alternative -- what this was before -- meant re-dropping their export and
 * re-typing a whole bodyweight history on every reload, which made the tab
 * something you used once.
 *
 * Only raw inputs live here. Everything derived stays a `useMemo` in the view, so
 * this store can never disagree with what is on screen.
 */

export type { CompareScale, ComparePerson };

/** Writes are debounced: the name and the weight cells are typed a key at a time. */
export const WRITE_DEBOUNCE_MS = 400;

const listeners = new Set<() => void>();
let current: ComparePerson | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

function emit(): void {
  for (const l of listeners) l();
}

function cancelPendingWrite(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

function schedule(): void {
  cancelPendingWrite();
  timer = setTimeout(() => {
    timer = null;
    void saveComparePerson(current);
  }, WRITE_DEBOUNCE_MS);
}

const EMPTY: ComparePerson = { label: '', scale: 'absolute', bodyweight: [], import: null };

/**
 * Drop their export in beside whatever is already known about them.
 *
 * Their name and bodyweight survive a new file on purpose: the common case for
 * replacing the CSV is a fresher export from the SAME person. `label` is seeded
 * from the filename only when it is still blank, so a name you typed is never
 * overwritten by a file you drop afterwards.
 */
export function setCompareImport(raw: RawImport): void {
  const base = current ?? EMPTY;
  current = {
    ...base,
    label: base.label.trim() === '' ? labelFromFilename(raw.filename) : base.label,
    import: raw,
  };
  schedule();
  emit();
}

/**
 * Edits the fields around the file -- their name, their bodyweight, the scale
 * toggle.
 *
 * Unlike the version this replaced, a patch with nothing loaded SEEDS a person
 * rather than being ignored. That is what lets you name them and enter their
 * bodyweight before their export exists, which is the order people actually do
 * it in when the CSV has to be asked for.
 */
export function patchComparePerson(patch: Partial<Omit<ComparePerson, 'import'>>): void {
  current = { ...(current ?? EMPTY), ...patch };
  schedule();
  emit();
}

/** Removes their export but keeps the person -- their name and weights stay. */
export function clearCompareImport(): void {
  if (current === null) return;
  current = { ...current, import: null };
  schedule();
  emit();
}

/**
 * Forget them entirely, and delete the key rather than storing an empty record.
 * The pending debounce is cancelled first: without that, a write scheduled a
 * keystroke ago lands after the delete and resurrects them.
 */
export function clearComparePerson(): void {
  cancelPendingWrite();
  current = null;
  void saveComparePerson(null);
  emit();
}

/**
 * Seed from IndexedDB at startup, WITHOUT writing back -- a hydration that
 * scheduled a save would rewrite the record on every page load. Called from the
 * one place that already awaits IDB, `useWorkoutData`'s hydration effect.
 *
 * Idempotent, and refuses to clobber: StrictMode double-invokes that effect, and
 * a slow read must not overwrite something the user has already typed.
 */
export function hydrateComparePerson(person: ComparePerson | null): void {
  if (current !== null) return;
  current = person;
  emit();
}

/** Exported because they ARE the external-store contract, and are testable without React. */
export function subscribeComparePerson(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getComparePerson(): ComparePerson | null {
  return current;
}

function getServerSnapshot(): ComparePerson | null {
  return null;
}

export function useComparePerson(): ComparePerson | null {
  return useSyncExternalStore(subscribeComparePerson, getComparePerson, getServerSnapshot);
}

// --- naming ------------------------------------------------------------------

/** Tokens that describe the FILE rather than the person who exported it. */
const FILENAME_NOISE = new Set([
  'strong',
  'strongapp',
  'workout',
  'workouts',
  'training',
  'trainings',
  'log',
  'logs',
  'export',
  'exported',
  'data',
  'backup',
  'copy',
  'final',
  'new',
  'csv',
  'measurements',
  'weight',
  'bodyweight',
]);

/**
 * A first guess at what to call them, from what they named the file.
 *
 * `alex_strong_2025.csv` -> `Alex`. Only a guess, and always overwritable: the
 * name field sits right there. Returns '' rather than inventing something when
 * the filename is all noise, which is the honest answer for `strong.csv` and
 * lets the placeholder show through.
 */
export function labelFromFilename(filename: string): string {
  const base = filename
    .replace(/\.[a-z0-9]+$/i, '')
    // "theirs (1).csv" -- a browser's duplicate-download suffix, never a name.
    .replace(/\((\d+)\)/g, ' ');

  const words = base
    .split(/[\s_\-.,+]+/)
    .map((w) => w.trim())
    .filter((w) => w !== '')
    // Pure digits are dates and version numbers; 20250814 is not a person.
    .filter((w) => !/^\d+$/.test(w))
    .filter((w) => !FILENAME_NOISE.has(w.toLowerCase()));

  if (words.length === 0) return '';

  return words
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 24);
}
