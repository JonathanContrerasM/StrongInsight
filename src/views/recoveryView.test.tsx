// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Recovery } from './Recovery';
import { WorkoutDataProvider, useWorkoutData } from '../store/useWorkoutData';
import { SAMPLE_FIXTURE } from '../test/fixtures';

/**
 * The Recovery tab against the synthetic fixture. The sample's sessions are
 * years old, so it is a stale export by construction -- exactly the case where
 * "as of today" would show a fully recovered body and say nothing.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CSV = readFileSync(SAMPLE_FIXTURE, 'utf8');

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

function Imported() {
  const data = useWorkoutData();
  useEffect(() => {
    if (data.status === 'loading') return;
    if (data.current === null) void data.importCsv(CSV, 'mine.csv');
  }, [data]);
  return <Recovery />;
}

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(<WorkoutDataProvider>{node}</WorkoutDataProvider>);
  });
  await act(async () => {});
  return container;
}

/** The body map is a lazy chunk; its first load can outlast a few microtasks. */
const bodies = () => container.querySelectorAll('svg[aria-label^="Body,"]');
async function untilMap() {
  for (let i = 0; i < 100 && bodies().length < 2; i++) {
    await act(async () => new Promise((r) => setTimeout(r, 20)));
  }
  expect(bodies().length).toBe(2);
}

const text = () => container.textContent ?? '';
const buttonText = (label: string) =>
  [...container.querySelectorAll('button')].find((b) => b.textContent === label)!;

describe('the Recovery tab', () => {
  it('asks for an import before anything else', async () => {
    await mount(<Recovery />);
    expect(text()).toContain('Nothing imported yet');
  });

  it('anchors a stale export to its last session, and says so', async () => {
    await mount(<Imported />);
    expect(text()).toContain('days old');
    expect(text()).toContain('After the last session');
    await untilMap();
    expect(container.querySelector('g[fill^="var(--chart-fatigue"]')).toBeTruthy();
    expect(text()).toContain('By muscle');
  });

  it('switches to now on request, where an old export has fully recovered', async () => {
    await mount(<Imported />);
    await act(async () => buttonText('Now').click());
    expect(text()).toContain('Train today');
    // Every group tile reads Ready.
    expect(text().match(/Ready/g)!.length).toBeGreaterThanOrEqual(4);
    await untilMap();
    expect(container.querySelector('g[fill^="var(--chart-fatigue"]')).toBeNull();
  });

  it('forecasts forward from the anchor, never adding fatigue', async () => {
    await mount(<Imported />);
    await untilMap();
    const pcts = () =>
      [...container.querySelectorAll('[role="meter"]')].map((m) => Number(m.getAttribute('aria-valuenow')));
    const before = pcts();
    expect(before.length).toBeGreaterThan(0);
    await act(async () => buttonText('+72 h').click());
    expect(text()).toContain('Ready to train in 72 h');
    expect(text()).toContain('assuming no training until then');
    const after = pcts();
    expect(Math.max(0, ...after)).toBeLessThanOrEqual(Math.max(...before));
  });

  it('shows weekly volume and the fatigue history', async () => {
    await mount(<Imported />);
    expect(text()).toContain('Hard sets, last 7 days');
    expect(text()).toContain('Went in fatigued');
    expect(container.querySelector('svg[aria-label="Fatigue per muscle per day"]')).toBeTruthy();
  });
});
