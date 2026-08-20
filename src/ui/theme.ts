import { useCallback, useSyncExternalStore } from 'react';

/**
 * Theme preference: light, dark, or follow the OS.
 *
 * Deliberately NOT part of `Settings`. Settings live in IndexedDB and load
 * asynchronously, and App renders a loading state while that happens -- a theme
 * read from there would arrive after first paint and flash white on every
 * reload. localStorage is synchronous, so the inline boot script in index.html
 * can stamp `.dark` onto <html> before anything renders.
 *
 * The class goes on the documentElement rather than the app root because the
 * chart tooltip portals to document.body, outside the React tree.
 */

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

/** Must match the key read by the boot script in index.html. */
export const STORAGE_KEY = 'stronginsight:theme';

export const THEMES: readonly Theme[] = ['light', 'dark', 'system'] as const;

function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark' || value === 'system';
}

function prefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function readTheme(): Theme {
  if (typeof localStorage === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    // Private-browsing modes throw on access rather than returning null.
    return 'system';
  }
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/**
 * Applies the resolved theme to <html>. Safe to call repeatedly.
 *
 * Must set the same three things the boot script in index.html sets. The inline
 * `backgroundColor` in particular outranks any stylesheet rule once written, so
 * leaving it stale here would pin the page to the boot-time colour forever.
 */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const dark = resolveTheme(theme) === 'dark';
  const el = document.documentElement;
  el.classList.toggle('dark', dark);
  el.style.colorScheme = dark ? 'dark' : 'light';
  el.style.backgroundColor = dark ? '#08090b' : '#f5f6f8';
}

// --- store --------------------------------------------------------------------

// A module-level store rather than context: the header control and the Settings
// control are in different subtrees and must stay in lockstep.
const listeners = new Set<() => void>();
let current: Theme = readTheme();

function emit(): void {
  for (const l of listeners) l();
}

export function setTheme(next: Theme): void {
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Preference simply will not persist; the session still honours it.
  }
  applyTheme(next);
  emit();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  // While on "system", track live OS changes -- the user can flip their theme
  // without reloading and the app must follow.
  const mq =
    typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
  const onSystemChange = () => {
    if (current === 'system') {
      applyTheme('system');
      onChange();
    }
  };
  mq?.addEventListener('change', onSystemChange);

  // Another tab may have changed the preference.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== STORAGE_KEY) return;
    current = readTheme();
    applyTheme(current);
    onChange();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    mq?.removeEventListener('change', onSystemChange);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

function getSnapshot(): Theme {
  return current;
}

function getServerSnapshot(): Theme {
  return 'system';
}

export function useTheme(): {
  theme: Theme;
  resolved: ResolvedTheme;
  setTheme: (t: Theme) => void;
} {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const set = useCallback((t: Theme) => setTheme(t), []);
  return { theme, resolved: resolveTheme(theme), setTheme: set };
}
