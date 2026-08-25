import { useSyncExternalStore } from 'react';

/**
 * The other person's export, held across tab switches.
 *
 * App renders views as `{activeTab === 'compare' && <Compare />}`, so leaving the
 * tab unmounts the component. With the file in component state that meant
 * re-dropping the CSV and re-typing their bodyweight every time you glanced at
 * the dashboard.
 *
 * A module-level store rather than lifting it into App: the same shape as
 * `ui/theme.ts`, and for the same reason -- state that has to outlive one
 * component's mount without being threaded through a parent that does not
 * otherwise care about it.
 *
 * Deliberately NOT persisted. No IndexedDB key, no sessionStorage. This is
 * someone else's training history and it should leave when the page does; a
 * plain module variable gives that for free on reload.
 *
 * Only raw inputs live here. Everything derived stays a `useMemo` in the view,
 * so this store can never disagree with what is on screen.
 */

export type CompareScale = 'absolute' | 'relative';

export type CompareCorpus = {
  filename: string;
  /** Raw CSV text, parsed fresh on each mount. */
  text: string;
  /** What to call them in the UI. */
  label: string;
  /**
   * Their bodyweight AS TYPED, not as a number.
   *
   * A controlled number input bound to a parsed value eats the decimal point
   * while you are still typing "78.5", because Number('78.') is 78. Keeping the
   * raw string here also keeps this store to raw inputs only, which is the rule
   * that stops it disagreeing with the screen.
   */
  bodyweightInput: string;
  scale: CompareScale;
};

const listeners = new Set<() => void>();
let current: CompareCorpus | null = null;

function emit(): void {
  for (const l of listeners) l();
}

/** A new file replaces whatever was loaded, including its name and bodyweight. */
export function loadCompareCorpus(next: CompareCorpus): void {
  current = next;
  emit();
}

/**
 * Edits the fields around the file -- their name, their bodyweight, the scale
 * toggle -- without disturbing the file itself. A no-op when nothing is loaded,
 * so a stray edit cannot conjure a corpus with no CSV in it.
 */
export function patchCompareCorpus(
  patch: Partial<Omit<CompareCorpus, 'text' | 'filename'>>,
): void {
  if (current === null) return;
  current = { ...current, ...patch };
  emit();
}

export function clearCompareCorpus(): void {
  current = null;
  emit();
}

/** Exported because they ARE the external-store contract, and are testable without React. */
export function subscribeCompareCorpus(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function getCompareCorpus(): CompareCorpus | null {
  return current;
}

function getServerSnapshot(): CompareCorpus | null {
  return null;
}

export function useCompareCorpus(): CompareCorpus | null {
  return useSyncExternalStore(subscribeCompareCorpus, getCompareCorpus, getServerSnapshot);
}
