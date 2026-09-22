// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DateRangePicker, dayKey, type DayRange } from './DateRangePicker';

/**
 * The calendar on its own: the grid must start on the configured weekday,
 * show two months that never run past the corpus, and let only the days the
 * caller enabled be picked.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const MIN = new Date(2024, 10, 20);
const MAX = new Date(2025, 1, 10);
const ENABLED = new Set(['2024-11-20', '2024-12-02', '2024-12-04', '2025-01-06', '2025-02-10']);

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

/** A fresh root each time: the picker keeps its months in state, as it does for one opening of the popover. */
async function mount(
  value: DayRange,
  weekStartsOn: 0 | 1,
  calls: DayRange[],
  presets?: Array<{ label: string; range: DayRange }>,
  onClear?: () => void,
) {
  act(() => root.unmount());
  root = createRoot(container);
  await act(async () => {
    root.render(
      <DateRangePicker
        value={value}
        onChange={(r) => calls.push(r)}
        min={MIN}
        max={MAX}
        enabledDays={ENABLED}
        weekStartsOn={weekStartsOn}
        presets={presets}
        onClear={onClear}
      />,
    );
  });
}

const labels = () => [...container.querySelectorAll('.hud-label')].slice(0, 7).map((e) => e.textContent);
const day = (key: string) => container.querySelector('button[data-day="' + key + '"]') as HTMLButtonElement | null;
const byLabel = (label: string) =>
  container.querySelector('button[aria-label="' + label + '"]') as HTMLButtonElement;

describe('DateRangePicker', () => {
  it('starts the week on the configured day', async () => {
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, []);
    expect(labels()).toEqual(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 0, []);
    expect(labels()).toEqual(['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']);
  });

  it('opens on the months the range starts and ends in, and stops at the corpus', async () => {
    await mount({ from: new Date(2024, 11, 2), to: new Date(2025, 1, 10) }, 1, []);
    expect(day('2024-12-02')).not.toBeNull();
    expect(day('2025-01-06')).toBeNull();
    expect(day('2025-02-10')).not.toBeNull();
    expect(byLabel('Next month (end)').disabled).toBe(true);
    expect(byLabel('Previous month (start)').disabled).toBe(false);

    // A one-month range still shows two panels, the next month on the right.
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, []);
    expect(day('2025-01-06')).not.toBeNull();
    expect(byLabel('Next month (end)').disabled).toBe(false);
  });

  it('pages each panel on its own, and never lets them cross', async () => {
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, []);
    // Left is December, right is January: neither may step onto the other.
    expect(byLabel('Next month (start)').disabled).toBe(true);
    expect(byLabel('Previous month (end)').disabled).toBe(true);

    await act(async () => byLabel('Next month (end)').click());
    expect(day('2025-02-10')).not.toBeNull();
    expect(day('2024-12-02')).not.toBeNull(); // the left panel did not move
    expect(byLabel('Next month (start)').disabled).toBe(false);
    expect(byLabel('Previous month (end)').disabled).toBe(false);
  });

  it('sticks the left panel to the month the start was picked in', async () => {
    const calls: DayRange[] = [];
    await mount({ from: new Date(2024, 10, 20), to: new Date(2024, 11, 4) }, 1, calls);
    // November on the left, December on the right; pick a start in December.
    await act(async () => day('2024-12-02')!.click());
    expect(calls).toHaveLength(1);
    // Left is now December; the right panel was pushed on to January.
    expect(day('2024-11-20')).toBeNull();
    expect(day('2025-01-06')).not.toBeNull();
    // Paging the right panel leaves the left one where it is.
    await act(async () => byLabel('Next month (end)').click());
    expect(day('2024-12-02')).not.toBeNull();
    expect(day('2025-02-10')).not.toBeNull();
    await act(async () => day('2025-02-10')!.click());
    expect(calls[1]).toEqual({ from: new Date(2024, 11, 2), to: new Date(2025, 1, 10) });
  });

  it('enables only the days it was given, and marks the endpoints', async () => {
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, []);
    expect(day('2024-12-02')!.disabled).toBe(false);
    expect(day('2024-12-03')!.disabled).toBe(true);
    expect(day('2024-12-02')!.getAttribute('aria-pressed')).toBe('true');
    expect(day('2024-12-04')!.getAttribute('aria-pressed')).toBe('true');
    expect(day('2024-12-03')!.getAttribute('aria-pressed')).toBe('false');
    expect(container.textContent).toContain('2 session days');
  });

  it('makes a range from two clicks in either order, applying the first at once', async () => {
    const calls: DayRange[] = [];
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, calls);
    await act(async () => day('2025-01-06')!.click());
    expect(calls).toEqual([{ from: new Date(2025, 0, 6), to: new Date(2025, 0, 6) }]);
    // The left panel now holds January; page it back to reach an earlier day.
    await act(async () => byLabel('Previous month (start)').click());
    await act(async () => day('2024-12-04')!.click());
    expect(calls[1]).toEqual({ from: new Date(2024, 11, 4), to: new Date(2025, 0, 6) });
  });

  it('applies a preset in one click and moves the panels to it', async () => {
    const calls: DayRange[] = [];
    const jan = { from: new Date(2025, 0, 1), to: new Date(2025, 1, 10) };
    await mount({ from: new Date(2024, 10, 20), to: new Date(2024, 11, 4) }, 1, calls, [
      { label: '2024', range: { from: MIN, to: new Date(2024, 11, 31) } },
      { label: '2025', range: jan },
    ]);
    const chip = [...container.querySelectorAll('button')].find((b) => b.textContent === '2025')!;
    expect(chip.getAttribute('aria-pressed')).toBe('false');
    await act(async () => chip.click());
    expect(calls).toEqual([jan]);
    // November is gone; the panels now show January and February.
    expect(day('2024-11-20')).toBeNull();
    expect(day('2025-01-06')).not.toBeNull();
    expect(day('2025-02-10')).not.toBeNull();
  });

  it('offers Clear only when asked, and leaves what it means to the caller', async () => {
    const calls: DayRange[] = [];
    const find = () => [...container.querySelectorAll('button')].find((b) => b.textContent === 'Clear');
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, calls);
    expect(find()).toBeUndefined();

    let cleared = 0;
    await mount({ from: new Date(2024, 11, 2), to: new Date(2024, 11, 4) }, 1, calls, undefined, () => cleared++);
    await act(async () => find()!.click());
    expect(cleared).toBe(1);
    expect(calls).toEqual([]);
  });

  it('keys days the way the caller does', () => {
    expect(dayKey(new Date(2025, 0, 6, 23, 30))).toBe('2025-01-06');
  });
});
