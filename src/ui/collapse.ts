import { useCallback, useSyncExternalStore } from 'react';

/**
 * Which view sections are folded away.
 *
 * Per device, in localStorage, like the theme -- a way of looking, not data, so
 * it is not in Settings and Reset everything leaves it alone. Synchronous, so a
 * collapsed section does not flash open on reload.
 *
 * Stored as a JSON array of collapsed ids; anything unreadable means "all open".
 */

export const COLLAPSE_KEY = 'stronginsight:collapsed';

const listeners = new Set<() => void>();
let cache: { raw: string | null; ids: ReadonlySet<string> } | null = null;

function readRaw(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem(COLLAPSE_KEY);
  } catch {
    // Private-browsing modes throw on access rather than returning null.
    return null;
  }
}

function parse(raw: string | null): ReadonlySet<string> {
  if (raw === null) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Stable between changes, as useSyncExternalStore requires. */
function snapshot(): ReadonlySet<string> {
  const raw = readRaw();
  if (!cache || cache.raw !== raw) cache = { raw, ids: parse(raw) };
  return cache.ids;
}

function write(ids: ReadonlySet<string>): void {
  const raw = JSON.stringify([...ids].sort());
  try {
    localStorage.setItem(COLLAPSE_KEY, raw);
    cache = null;
  } catch {
    // Storage refused: keep the choice for this page view only.
    cache = { raw: readRaw(), ids };
  }
  for (const l of listeners) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: ReadonlySet<string> = new Set();

export function useCollapsed(id: string): [collapsed: boolean, toggle: () => void] {
  const ids = useSyncExternalStore(subscribe, snapshot, () => EMPTY);
  const toggle = useCallback(() => {
    const next = new Set(snapshot());
    if (next.has(id)) next.delete(id);
    else next.add(id);
    write(next);
  }, [id]);
  return [ids.has(id), toggle];
}
