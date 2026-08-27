/**
 * The tab table, and the one rule about which tabs work without an import.
 *
 * This lives outside App because the rule was previously expressed three times
 * -- once in each of the two nav rails and once in the redirect guard -- and the
 * three disagreed. Dashboard, Improvements and Compare silently bounced you to
 * Import, while Exercises and the tagging tray opened onto a dead end telling
 * you to go back to Import.
 *
 * One table, one predicate, and a test that pins the exact set.
 */

export type Tab =
  | 'dashboard'
  | 'improvements'
  | 'exercises'
  | 'compare'
  | 'tray'
  | 'import'
  | 'settings';

export type TabSpec = {
  id: Tab;
  label: string;
  /** True when the tab has nothing to show until a CSV has been imported. */
  needsData: boolean;
};

/** Array order is nav order. */
export const TABS: readonly TabSpec[] = [
  { id: 'dashboard', label: 'Dashboard', needsData: true },
  { id: 'improvements', label: 'Improvements', needsData: true },
  { id: 'exercises', label: 'Exercises', needsData: true },
  { id: 'compare', label: 'Compare', needsData: true },
  { id: 'tray', label: 'Tagging tray', needsData: true },
  { id: 'import', label: 'Import', needsData: false },
  { id: 'settings', label: 'Settings', needsData: false },
];

export function tabEnabled(tab: Tab, hasData: boolean): boolean {
  if (hasData) return true;
  return TABS.find((t) => t.id === tab)?.needsData === false;
}

/** Shown on a disabled tab, so the nav explains itself rather than going quiet. */
export const DISABLED_HINT = 'Import a CSV first';

// --- the URL hash ------------------------------------------------------------
//
// The app is one page with tab state, not a router, and that stays true. But the
// landing page at `/` has to be able to send someone to a particular section --
// `/app.html#compare` -- so the hash is read on mount and written on every
// navigation. Pure string functions here; the wiring is a dozen lines in App.
//
// The rule that earns its keep: EVERY view state reachable by clicking must be
// addressable. Tabs alone were not enough. Opening a lift from the Exercises
// table used to set component state and leave the hash alone, so it created no
// history entry -- and the browser Back button skipped the list entirely and
// landed on whatever tab came before it. Hence the detail segment.
//
// Note what this deliberately does NOT do: it does not bypass `tabEnabled`.
// A link to `#compare` with nothing imported still falls through the same guard
// a click would, and lands on Import.

/** A tab, plus -- on `exercises` only -- the lift being looked at. */
export type Route = { tab: Tab; detail: string | null };

/**
 * What a bare `/app.html` shows.
 *
 * Navigating Back to a hash-less URL has to agree with a cold load of the same
 * URL. They used to disagree: the mount defaulted to the dashboard while the
 * hashchange handler ignored an unrecognised hash entirely, freezing the view.
 */
export const DEFAULT_ROUTE: Route = { tab: 'dashboard', detail: null };

/**
 * `'#exercises/Bench%20Press'` -> `{ tab: 'exercises', detail: 'Bench Press' }`.
 * Anything unrecognised is `null`, never a throw, so the caller keeps its default.
 */
export function routeFromHash(hash: string): Route | null {
  const raw = hash.replace(/^#/, '');
  if (raw === '') return null;

  // First slash only. The name is percent-encoded on the way out, which turns
  // any `/` inside it into %2F -- so this split can never be ambiguous.
  const cut = raw.indexOf('/');
  const id = cut === -1 ? raw : raw.slice(0, cut);
  const tab = TABS.find((t) => t.id === id)?.id;
  if (!tab) return null;
  if (cut === -1) return { tab, detail: null };

  // A detail segment is meaningful only on `exercises`. Anywhere else the route
  // is malformed rather than "that tab, segment ignored".
  if (tab !== 'exercises') return null;

  const rest = raw.slice(cut + 1);
  if (rest === '') return { tab, detail: null };
  try {
    // Throws URIError on a mangled escape like `%zz`. A hand-edited URL must
    // degrade to the default route, not take the app down on mount.
    return { tab, detail: decodeURIComponent(rest) };
  } catch {
    return null;
  }
}

/** The inverse. Kept beside its partner so the two cannot drift. */
export function hashForRoute(tab: Tab, detail: string | null = null): string {
  if (tab === 'exercises' && detail) return '#exercises/' + encodeURIComponent(detail);
  return '#' + tab;
}
