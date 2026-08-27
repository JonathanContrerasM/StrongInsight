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
// `/app.html#compare` -- so the hash is read on mount and written on every tab
// change. Two pure string functions here; the wiring is six lines in App.
//
// Note what this deliberately does NOT do: it does not bypass `tabEnabled`.
// A link to `#compare` with nothing imported still falls through the same guard
// a click would, and lands on Import.

/** `'#compare'` -> `'compare'`. Anything unrecognised is `null`, never a throw. */
export function tabFromHash(hash: string): Tab | null {
  const id = hash.replace(/^#/, '');
  return TABS.find((t) => t.id === id)?.id ?? null;
}

/** The inverse. Kept beside its partner so the two cannot drift. */
export function hashForTab(tab: Tab): string {
  return '#' + tab;
}
