// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Import } from './Import';
import { SettingsView } from './Settings';
import { WorkoutDataProvider, useWorkoutData } from '../store/useWorkoutData';
import { SAMPLE_FIXTURE } from '../test/fixtures';

/**
 * The Import tab, mounted for real. What is worth pinning is the pairing: the
 * bodyweight history lives with the export it resolves against, and the
 * first-run notice says in the export's own numbers why it matters.
 */

const TEST_WIDTH = 800;

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;
Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', {
  configurable: true,
  value: () => ({ width: TEST_WIDTH, height: 300, top: 0, left: 0, right: TEST_WIDTH, bottom: 300 }),
});

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

let api: ReturnType<typeof useWorkoutData> | null = null;

function Loaded({ text, children }: { text: string; children: React.ReactNode }) {
  const data = useWorkoutData();
  api = data;
  useEffect(() => {
    if (data.status === 'loading') return;
    if (data.current === null) void data.importCsv(text, 'mine.csv');
  }, [data, text]);
  return <>{children}</>;
}

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(<WorkoutDataProvider>{node}</WorkoutDataProvider>);
  });
  await act(async () => {});
  return container;
}

function text(): string {
  return container.textContent ?? '';
}

describe('the Import tab', () => {
  it('shows only the landing before anything is imported', async () => {
    await mount(<Import />);
    expect(text()).toContain('Drop your Strong CSV export here');
    expect(text()).not.toContain('Your bodyweight');
    expect(text()).not.toContain('Import report');
  });

  it('pairs the bodyweight history with the export, above the report, and says why', async () => {
    await mount(
      <Loaded text={CSV}>
        <Import />
      </Loaded>,
    );
    const t = text();
    expect(t).toContain('Your bodyweight');
    expect(t.indexOf('Your bodyweight')).toBeLessThan(t.indexOf('Import report'));
    // The fixture's pull ups and calf raises are bodyweight work, so the
    // notice can name what is being assumed and for how many sets.
    expect(t).toContain('No bodyweight recorded yet');
    expect(t).toMatch(/\d+ sets across \d+ bodyweight exercises/);
    expect(t).toContain('Pull Up');
    expect(t).toContain('assumed 80 kg');
    expect(t).toContain('Import weight CSV');

    await act(async () => api?.setBodyweight([{ date: '2023-02-01', kg: 82 }]));
    expect(text()).not.toContain('No bodyweight recorded yet');
    expect(text()).toContain('2023-02-01');
  });

  it('no longer carries a bodyweight section on Settings', async () => {
    await mount(
      <Loaded text={CSV}>
        <SettingsView />
      </Loaded>,
    );
    expect(text()).not.toContain('Bodyweight history');
    expect(text()).not.toContain('Import weight CSV');
    expect(text()).toContain('Units and week');
  });
});
