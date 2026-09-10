import { get, set, del, createStore, type UseStore } from 'idb-keyval';
import type {
  BodyweightEntry,
  ComparePerson,
  ExerciseMeta,
  RawImport,
  Settings,
} from '../model/types';
import { DEFAULT_SETTINGS } from '../model/types';
import {
  readBodyweight,
  readComparePerson,
  readMetaMap,
  readRawArchive,
  readRawImport,
  readSettings,
  type ValidationWarning,
} from '../model/schemas';

export const KEYS = {
  rawCurrent: 'raw:current',
  rawArchive: 'raw:archive',
  metaExercises: 'meta:exercises',
  metaBodyweight: 'meta:bodyweight',
  settings: 'settings',
  comparePerson: 'compare:person',
} as const;

/** Keep the last N imports so a bad rename can be rolled back. */
export const ARCHIVE_LIMIT = 5;

let store: UseStore | null = null;
function db(): UseStore {
  // Created lazily so importing this module in Node (tests) does not touch IDB.
  if (!store) store = createStore('stronginsight', 'kv');
  return store;
}

// --- write serialisation -----------------------------------------------------

/**
 * Serialises writes per key. Two callers touch meta:exercises -- the tagging tray
 * and the auto-extension effect -- and React StrictMode double-invokes effects in
 * development, so a read-modify-write race is otherwise easy to hit.
 */
const chains = new Map<string, Promise<unknown>>();

export function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  // Keep the chain alive but never let a rejection poison the next writer.
  chains.set(
    key,
    next.catch(() => undefined),
  );
  return next;
}

// --- reads (all degrade, never throw) ---------------------------------------

async function readRaw(key: string): Promise<unknown> {
  try {
    return await get(key, db());
  } catch {
    return undefined;
  }
}

export type LoadedState = {
  current: RawImport | null;
  archive: RawImport[];
  meta: Record<string, ExerciseMeta>;
  bodyweight: BodyweightEntry[];
  settings: Settings;
  /** The other person on the Compare tab. Null when there is not one. */
  comparePerson: ComparePerson | null;
  warnings: ValidationWarning[];
};

export async function loadAll(): Promise<LoadedState> {
  const warnings: ValidationWarning[] = [];
  const [rawCurrent, rawArchive, metaExercises, metaBodyweight, rawSettings, rawCompare] =
    await Promise.all([
      readRaw(KEYS.rawCurrent),
      readRaw(KEYS.rawArchive),
      readRaw(KEYS.metaExercises),
      readRaw(KEYS.metaBodyweight),
      readRaw(KEYS.settings),
      readRaw(KEYS.comparePerson),
    ]);

  return {
    current: readRawImport(KEYS.rawCurrent, rawCurrent, warnings),
    archive: readRawArchive(rawArchive, warnings),
    meta: readMetaMap(metaExercises, warnings),
    bodyweight: readBodyweight(metaBodyweight, warnings),
    settings: readSettings(rawSettings, warnings),
    comparePerson: readComparePerson(rawCompare, warnings),
    warnings,
  };
}

// --- writes ------------------------------------------------------------------

async function put(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value, db());
  } catch (err) {
    // Quota or a private-mode block: surfacing beats a silent data loss, but a
    // throw here would tear down the render tree.
    console.error('[stronginsight] failed to persist ' + key, err);
  }
}

/**
 * Replace the current import and push the previous one onto the archive ring.
 * Both keys move under one lock so a failure cannot leave them inconsistent.
 */
export function saveImport(next: RawImport): Promise<void> {
  return withLock(KEYS.rawCurrent, async () => {
    const prev = readRawImport(KEYS.rawCurrent, await readRaw(KEYS.rawCurrent), []);
    const archive = readRawArchive(await readRaw(KEYS.rawArchive), []);
    if (prev) archive.unshift(prev);
    await put(KEYS.rawArchive, archive.slice(0, ARCHIVE_LIMIT));
    await put(KEYS.rawCurrent, next);
  });
}

export function saveMeta(meta: Record<string, ExerciseMeta>): Promise<void> {
  return withLock(KEYS.metaExercises, () => put(KEYS.metaExercises, meta));
}

export function saveBodyweight(entries: BodyweightEntry[]): Promise<void> {
  return withLock(KEYS.metaBodyweight, () => put(KEYS.metaBodyweight, entries));
}

export function saveSettings(settings: Settings): Promise<void> {
  return withLock(KEYS.settings, () => put(KEYS.settings, settings));
}

/** Null deletes the key outright, so "forget them" leaves nothing behind. */
export function saveComparePerson(person: ComparePerson | null): Promise<void> {
  return withLock(KEYS.comparePerson, async () => {
    if (person === null) {
      try {
        await del(KEYS.comparePerson, db());
      } catch {
        /* nothing useful to do */
      }
      return;
    }
    await put(KEYS.comparePerson, person);
  });
}

export async function resetAll(): Promise<void> {
  for (const key of Object.values(KEYS)) {
    try {
      await del(key, db());
    } catch {
      /* nothing useful to do */
    }
  }
}

export { DEFAULT_SETTINGS };
