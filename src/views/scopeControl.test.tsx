// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ScopeControl, describeScope, rangePresets, seedRange } from './ScopeControl';
import type { Scope } from '../derive/buckets';

/**
 * The header's range control. The presets are a plain segmented control; what
 * is worth testing is the Custom seam: choosing it must start from the window
 * already on screen and open the calendar, the segment must then wear the
 * range as its label rather than growing the header, and picking days in the
 * calendar must hand back ordered local dates.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CORPUS = { from: new Date(2024, 0, 15), to: new Date(2025, 5, 20) };
const SESSION_DAYS = new Set(['2025-01-06', '2025-01-08', '2025-01-10', '2025-02-03', '2025-03-31']);

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Mounted with a live scope, so the control sees its own changes as App would show them. */
async function mount(initial: Scope, calls: Scope[]) {
  let scope = initial;
  const render = () =>
    root.render(
      <ScopeControl
        scope={scope}
        onChange={(s) => {
          calls.push(s);
          scope = s;
          render();
        }}
        dateRange={CORPUS}
        sessionDays={SESSION_DAYS}
        lastRecordAt={new Date(2025, 2, 31)}
        weekStartsOn={1}
      />,
    );
  await act(async () => render());
}

function button(label: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
}

const dialog = () => container.querySelector('[role="dialog"]');
const day = (key: string) => container.querySelector('button[data-day="' + key + '"]') as HTMLButtonElement;

describe('ScopeControl', () => {
  it('seeds Custom from the window already showing, and opens the calendar', async () => {
    const calls: Scope[] = [];
    await mount(null, calls);
    expect(dialog()).toBeNull();
    await act(async () => button('Custom').click());
    expect(calls).toEqual([{ from: CORPUS.from, to: CORPUS.to }]);
    expect(dialog()).not.toBeNull();

    calls.length = 0;
    await mount(3, calls);
    await act(async () => button('Custom').click());
    expect(calls).toEqual([{ from: new Date(2025, 2, 20), to: CORPUS.to }]);
  });

  it('wears the range as the segment label, in one row, and closes on Escape', async () => {
    const calls: Scope[] = [];
    await mount({ from: new Date(2025, 0, 1), to: new Date(2025, 2, 31) }, calls);
    expect(container.querySelector('input')).toBeNull();
    const segment = button('2025-01-01 → 2025-03-31');
    expect(segment.getAttribute('aria-pressed')).toBe('true');
    expect(dialog()).toBeNull();

    await act(async () => segment.click());
    expect(dialog()).not.toBeNull();
    expect(calls).toEqual([]); // reopening does not re-seed
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(dialog()).toBeNull();
  });

  it('only lets session days be picked, and orders a pair however it was clicked', async () => {
    const calls: Scope[] = [];
    await mount({ from: new Date(2025, 0, 1), to: new Date(2025, 2, 31) }, calls);
    await act(async () => button('2025-01-01 → 2025-03-31').click());
    expect(day('2025-01-07').disabled).toBe(true);
    expect(day('2025-01-08').disabled).toBe(false);

    // The panels open on January and March. Start from the March end...
    await act(async () => day('2025-03-31').click());
    expect(calls.pop()).toEqual({ from: new Date(2025, 2, 31), to: new Date(2025, 2, 31) });
    // ...which the left panel now holds; page it back to January for the other end.
    const back = container.querySelector('button[aria-label="Previous month (start)"]') as HTMLButtonElement;
    await act(async () => back.click());
    await act(async () => back.click());
    await act(async () => day('2025-01-08').click());
    expect(calls.pop()).toEqual({ from: new Date(2025, 0, 8), to: new Date(2025, 2, 31) });
    expect(button('2025-01-08 → 2025-03-31')).toBeDefined();

    await act(async () => button('Done').click());
    expect(dialog()).toBeNull();
  });

  it('clears back to all history from inside the picker', async () => {
    const calls: Scope[] = [];
    await mount({ from: new Date(2025, 0, 1), to: new Date(2025, 2, 31) }, calls);
    await act(async () => button('2025-01-01 → 2025-03-31').click());
    expect(dialog()).not.toBeNull();
    await act(async () => button('Clear').click());
    expect(calls).toEqual([null]);
    expect(dialog()).toBeNull();
    expect(button('All').getAttribute('aria-pressed')).toBe('true');
    expect(button('Custom')).toBeDefined();
  });

  it('offers a chip per year of the corpus, and one since the last PR', async () => {
    await mount({ from: new Date(2025, 0, 1), to: new Date(2025, 2, 31) }, []);
    await act(async () => button('2025-01-01 → 2025-03-31').click());
    for (const label of ['2024', '2025', 'Since last PR']) expect(button(label)).toBeDefined();
    expect(rangePresets(CORPUS, new Date(2025, 2, 31))).toEqual([
      { label: '2024', range: { from: CORPUS.from, to: new Date(2024, 11, 31) } },
      { label: '2025', range: { from: new Date(2025, 0, 1), to: CORPUS.to } },
      { label: 'Since last PR', range: { from: new Date(2025, 2, 31), to: CORPUS.to } },
    ]);
    // A record on the first day is not a window worth offering.
    expect(rangePresets(CORPUS, CORPUS.from).map((p) => p.label)).toEqual(['2024', '2025']);
  });

  it('describes each kind of scope in a sentence', () => {
    expect(describeScope(null)).toBeNull();
    expect(describeScope(6)).toBe('last 6 months');
    expect(describeScope({ from: new Date(2025, 0, 1), to: new Date(2025, 2, 31) })).toBe('2025-01-01 → 2025-03-31');
    // A preset older than the corpus seeds from the first session, not before it.
    expect(seedRange(12, { from: new Date(2025, 0, 1), to: new Date(2025, 5, 1) })).toEqual({
      from: new Date(2025, 0, 1),
      to: new Date(2025, 5, 1),
    });
  });
});
