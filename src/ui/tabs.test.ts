import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, TABS, hashForRoute, routeFromHash, tabEnabled, type Tab } from './tabs';

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

/**
 * The hash is the only address this app has, and two things depend on it being
 * total: the landing page links into a section, and the browser Back button has
 * to be able to retrace every step. An unrecognised hash must therefore degrade
 * to a default rather than throwing or resolving to something arbitrary.
 */
describe('routeFromHash', () => {
  it('resolves every tab in the table', () => {
    for (const t of TABS) expect(routeFromHash('#' + t.id)).toEqual({ tab: t.id, detail: null });
  });

  it('tolerates a missing leading hash', () => {
    expect(routeFromHash('compare')).toEqual({ tab: 'compare', detail: null });
  });

  it('returns null for anything it does not recognise', () => {
    for (const h of ['', '#', '#nonsense', '#Dashboard', '#import ']) {
      expect(routeFromHash(h), JSON.stringify(h) + ' should not resolve').toBeNull();
    }
  });

  it('round-trips through hashForRoute', () => {
    for (const t of TABS) expect(routeFromHash(hashForRoute(t.id))).toEqual({ tab: t.id, detail: null });
  });

  it('does not bypass the data gate', () => {
    // A link to a locked tab resolves to that tab; `tabEnabled` is what refuses
    // it, exactly as it refuses a click. The two rules stay separate.
    const locked = routeFromHash('#compare');
    expect(locked?.tab).toBe('compare');
    expect(tabEnabled('compare', false)).toBe(false);
  });
});

/**
 * The open lift is part of the address.
 *
 * It was not, once, and the bug that caused is the reason these exist: opening
 * an exercise set component state without touching the hash, so it pushed no
 * history entry and Back skipped the list to whatever tab preceded it.
 */
describe('routeFromHash with a lift', () => {
  it('decodes the name', () => {
    expect(routeFromHash('#exercises/Bench%20Press%20(Barbell)')).toEqual({
      tab: 'exercises',
      detail: 'Bench Press (Barbell)',
    });
  });

  it('treats a bare or empty segment as the list', () => {
    expect(routeFromHash('#exercises')).toEqual({ tab: 'exercises', detail: null });
    expect(routeFromHash('#exercises/')).toEqual({ tab: 'exercises', detail: null });
  });

  /*
   * Names come from whatever the user typed into Strong, so they are entirely
   * unconstrained -- the reference corpus already carries `deadhang`, `katana`,
   * `Sally Challange` and one name with a trailing space. None of its 130 names
   * happens to contain a URL-significant character today, which is exactly the
   * kind of luck that stops being true later.
   */
  const HOSTILE = [
    'Bench Press (Barbell)',
    'Triceps Pushdown (Cable - Straight Bar)',
    'Single Leg Extension ', // the corpus really does carry this trailing space
    'Push Up (Knees)',
    'Front/Back Lever',      // a slash: must not split the route
    'Curl 100% Effort',      // a percent: must not read as an escape
    'Kabelzug rear shoulder',
    'Übungen mit Umlaut',
    'a b',
  ];

  it.each(HOSTILE)('round-trips %j', (name) => {
    expect(routeFromHash(hashForRoute('exercises', name))).toEqual({
      tab: 'exercises',
      detail: name,
    });
  });

  it('never emits a raw slash inside the name', () => {
    // If it did, the split in routeFromHash would be ambiguous.
    expect(hashForRoute('exercises', 'Front/Back Lever')).toBe('#exercises/Front%2FBack%20Lever');
  });

  it('refuses a segment on any other tab', () => {
    // Not "that tab, segment ignored" -- the route is malformed and the caller
    // should fall back rather than half-honour it.
    for (const t of TABS.filter((x) => x.id !== 'exercises')) {
      expect(routeFromHash('#' + t.id + '/Bench%20Press'), t.id + ' took a segment').toBeNull();
    }
  });

  it('survives a mangled escape rather than throwing', () => {
    // decodeURIComponent throws URIError on this; a hand-edited URL must not
    // take the app down on mount.
    expect(() => routeFromHash('#exercises/%zz')).not.toThrow();
    expect(routeFromHash('#exercises/%zz')).toBeNull();
  });

  it('ignores a detail on hashForRoute for a tab that cannot carry one', () => {
    expect(hashForRoute('dashboard', 'Bench Press')).toBe('#dashboard');
  });

  it('has a default that a hash-less URL falls back to', () => {
    // Back to a bare /app.html must show what a cold load of /app.html shows.
    expect(routeFromHash('') ?? DEFAULT_ROUTE).toEqual(DEFAULT_ROUTE);
    expect(tabEnabled(DEFAULT_ROUTE.tab, true)).toBe(true);
  });
});
