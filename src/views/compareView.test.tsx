// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Compare } from './Compare';
import { WorkoutDataProvider, useWorkoutData } from '../store/useWorkoutData';
import {
  clearComparePerson,
  hydrateComparePerson,
  setCompareImport,
  patchComparePerson,
} from '../store/comparePerson';
import { SAMPLE_FIXTURE } from '../test/fixtures';

/**
 * The Compare tab, mounted for real.
 *
 * The chart suite in `viz/render.test.tsx` mounts the pieces; this mounts the
 * page they sit on, wired to the actual store, because the things most likely to
 * break here are the joins: a bodyweight history reaching the resolver, a
 * persisted export being re-parsed with its own stamped unit, and a comparison
 * surviving a person who has a name but no file yet.
 *
 * There is no IndexedDB in jsdom, so every read degrades to a default and every
 * write is swallowed -- exactly the private-browsing path, and a fine substrate
 * for asserting what renders.
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
  clearComparePerson();
  hydrateComparePerson(null);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Imports your own corpus once mounted, so `data.current` is not null. */
function LoadYours({ text, yourKg }: { text: string; yourKg?: number }) {
  const data = useWorkoutData();
  useEffect(() => {
    if (data.status === 'loading') return;
    if (data.current === null) void data.importCsv(text, 'mine.csv');
    if (yourKg !== undefined && data.bodyweight.length === 0) {
      data.setBodyweight([{ date: '2024-06-01', kg: yourKg }]);
    }
  }, [data, text, yourKg]);
  return <Compare />;
}

async function mount(node: React.ReactNode) {
  await act(async () => {
    root.render(<WorkoutDataProvider>{node}</WorkoutDataProvider>);
  });
  // A second flush: hydration and the import both settle on microtasks.
  await act(async () => {});
  return container;
}

function text(): string {
  return container.textContent ?? '';
}

describe('the Compare tab', () => {
  it('asks for your own import before anything else', async () => {
    await mount(<Compare />);
    expect(text()).toContain('Nothing imported yet');
  });

  it('lets you name and weigh someone before their export exists', async () => {
    await mount(<LoadYours text={CSV} />);
    await act(async () => {
      patchComparePerson({ label: 'Alex', bodyweight: [{ date: '2024-06-01', kg: 74 }] });
    });

    expect(text()).toContain('Who you are comparing against');
    // The import button is disabled without a span to clip against, and says why.
    expect(text()).toContain('Drop their workout export first');
    // Their typed reading is in the table, and can be cleared on its own.
    expect(text()).toContain('2024-06-01');
    // The buttons name whoever you named.
    expect(text()).toContain('Remove Alex’s weights');
    // Nothing to remove on the other half yet.
    expect(text()).not.toContain('Remove Alex’s CSV');
  });

  it('compares, charts and offers the exports once both sides are loaded', async () => {
    await mount(<LoadYours text={CSV} />);
    await act(async () => {
      setCompareImport({
        text: CSV,
        filename: 'alex_strong.csv',
        importedAt: Date.now(),
        unit: 'kg',
      });
    });

    // The label was recovered from the filename.
    expect(text()).toContain('Only Alex');
    expect(text()).toContain('Remove Alex’s CSV');
    expect(text()).toContain('What can actually be compared');
    expect(text()).toContain('Export Markdown');
    expect(text()).toContain('Export lifts CSV');
    expect(text()).toContain('Rep distribution');
    expect(text()).toContain('Volume by muscle');
    // Comparing a corpus with itself: every lift lands at parity.
    expect(text()).toContain('Shared lifts');
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
  });

  /**
   * The point of the whole change: with no bodyweight for them, every
   * bodyweight movement is refused; with one, they are compared.
   */
  it('brings bodyweight movements in once their weight is known', async () => {
    // Both sides are needed: a bodyweight movement compares only when neither
    // lifter's own weight is a guess.
    await mount(<LoadYours text={CSV} yourKg={82} />);
    await act(async () => {
      setCompareImport({ text: CSV, filename: 'alex.csv', importedAt: Date.now(), unit: 'kg' });
    });
    expect(text()).toContain('Bodyweight movements are being left out');

    await act(async () => {
      patchComparePerson({ bodyweight: [{ date: '2024-06-01', kg: 74 }] });
    });
    expect(text()).not.toContain('Bodyweight movements are being left out');
  });

  /** With nobody named, the buttons fall back to neutral wording. */
  it('says "their" when no name has been given', async () => {
    await mount(<LoadYours text={CSV} />);
    await act(async () => {
      setCompareImport({ text: CSV, filename: 'strong.csv', importedAt: Date.now(), unit: 'kg' });
    });
    // 'strong' is a filename noise token, so nothing was seeded.
    expect(text()).toContain('Remove their CSV');
    // No possessive is ever built out of the "Them" placeholder.
    expect(text()).not.toContain('Them’s');
    expect(text()).toContain('Record their bodyweight above');
  });

  /**
   * Created purely by persistence: a file validated at drop time is not a
   * validated file after a parser change. It must degrade, not white-screen.
   */
  it('degrades rather than throwing on a stored export it can no longer parse', async () => {
    await mount(<LoadYours text={CSV} />);
    await act(async () => {
      setCompareImport({
        text: 'nothing,like,a,strong,export\n1,2,3,4,5\n',
        filename: 'broken.csv',
        importedAt: Date.now(),
        unit: 'kg',
      });
    });
    expect(text()).toContain('Their stored export can no longer be read');
  });
});
