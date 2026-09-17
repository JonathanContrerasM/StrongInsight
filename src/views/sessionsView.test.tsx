// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SessionList } from './SessionList';
import { SessionDetail } from './SessionDetail';
import { WorkoutDataProvider, useWorkoutData } from '../store/useWorkoutData';
import { SAMPLE_FIXTURE } from '../test/fixtures';

/**
 * The Sessions tab, mounted for real against the synthetic fixture. The join
 * worth testing is list -> detail -> lift: a row click must land on the session
 * it names, and the detail must show the rows Strong logged, not a derivation.
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

/** A tiny stand-in for the App shell: list until a row is clicked, then detail. */
function Sessions({ text }: { text: string }) {
  const data = useWorkoutData();
  const [open, setOpen] = useState<string | null>(null);
  const [lift, setLift] = useState<string | null>(null);
  useEffect(() => {
    if (data.status === 'loading') return;
    if (data.current === null) void data.importCsv(text, 'mine.csv');
  }, [data, text]);
  if (lift) return <div data-testid="lift">{lift}</div>;
  if (open) {
    return (
      <SessionDetail
        workoutId={open}
        onBack={() => setOpen(null)}
        onSelectSession={setOpen}
        onSelectExercise={setLift}
      />
    );
  }
  return <SessionList onSelectSession={setOpen} onSelectExercise={setLift} />;
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

describe('the Sessions tab', () => {
  it('asks for an import before anything else', async () => {
    await mount(<SessionList onSelectSession={() => {}} />);
    expect(text()).toContain('Nothing imported yet');
  });

  it('lists every workout, opens one, and links through to a lift', async () => {
    await mount(<Sessions text={CSV} />);
    const rows = container.querySelectorAll('tbody tr');
    expect(rows.length).toBeGreaterThan(10);
    expect(text()).toContain('click a row for every set');

    const first = rows[0] as HTMLTableRowElement;
    const date = first.querySelector('.num')?.textContent ?? '';
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    await act(async () => {
      first.click();
    });
    // The detail is headed by the same date, and shows the sets in order.
    expect(container.querySelector('h2')?.textContent).toBe(date);
    expect(text()).toContain('In order');
    expect(text()).toContain('All sessions');
    expect(text()).toContain('Previous');
    expect(container.querySelectorAll('table').length).toBeGreaterThan(0);

    // Each exercise block is headed by a button into the lift.
    const liftButton = container.querySelector('h3 button') as HTMLButtonElement;
    const liftName = liftButton.textContent ?? '';
    await act(async () => {
      liftButton.click();
    });
    expect(container.querySelector('[data-testid="lift"]')?.textContent).toBe(liftName);
  });

  it('degrades to a not-found state on a stale id', async () => {
    function Stale() {
      const data = useWorkoutData();
      useEffect(() => {
        if (data.status !== 'loading' && data.current === null) void data.importCsv(CSV, 'mine.csv');
      }, [data]);
      return (
        <SessionDetail
          workoutId="not-a-session"
          onBack={() => {}}
          onSelectSession={() => {}}
          onSelectExercise={() => {}}
        />
      );
    }
    await mount(<Stale />);
    expect(text()).toContain('not in the current import');
  });
});
