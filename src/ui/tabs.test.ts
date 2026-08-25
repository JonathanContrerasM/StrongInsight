import { describe, expect, it } from 'vitest';
import { TABS, tabEnabled, type Tab } from './tabs';

/**
 * The empty app used to navigate three different ways at once: Dashboard,
 * Improvements and Compare silently bounced you to Import, while Exercises and
 * the tagging tray opened onto a dead end telling you to go back to Import.
 *
 * This pins the exact set, so a tab added later without a deliberate `needsData`
 * decision fails here rather than quietly picking a behaviour.
 */

const DISABLED_WITHOUT_DATA: Tab[] = [
  'dashboard',
  'improvements',
  'exercises',
  'compare',
  'tray',
];
const ALWAYS_ENABLED: Tab[] = ['import', 'settings'];

describe('tabEnabled', () => {
  it('locks exactly the data-dependent tabs when nothing is imported', () => {
    for (const t of DISABLED_WITHOUT_DATA) {
      expect(tabEnabled(t, false), t + ' should be locked').toBe(false);
    }
  });

  it('always leaves a way in and a way to settings', () => {
    for (const t of ALWAYS_ENABLED) {
      expect(tabEnabled(t, false), t + ' should stay open').toBe(true);
    }
  });

  it('opens everything once a corpus exists', () => {
    for (const t of TABS) expect(tabEnabled(t.id, true)).toBe(true);
  });

  it('covers every tab in the table, with no unclassified stragglers', () => {
    const classified = [...DISABLED_WITHOUT_DATA, ...ALWAYS_ENABLED].sort();
    expect(TABS.map((t) => t.id).sort()).toEqual(classified);
  });

  it('agrees with the needsData flag it is derived from', () => {
    for (const t of TABS) expect(tabEnabled(t.id, false)).toBe(!t.needsData);
  });
});
