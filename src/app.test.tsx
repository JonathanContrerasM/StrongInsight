// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import App from './App';
import { SAMPLE_FIXTURE } from './test/fixtures';

/**
 * The whole app, cold. Every view has its own test, but only the real shell
 * crosses the loading boundary: a hook placed after the "Loading your
 * history..." return renders fine in isolation and blanks the app on the
 * second render. This mounts App exactly as main.tsx does, imports the
 * fixture through the Import tab, and walks to the Dashboard's range control.
 */

const TEST_WIDTH = 1200;

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
  window.location.hash = '';
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const text = () => container.textContent ?? '';

function button(label: string): HTMLButtonElement {
  return [...container.querySelectorAll('button')].find((b) => b.textContent === label) as HTMLButtonElement;
}

/** jsdom has no DataTransfer; see bodyweightEditor.test.tsx for why `files` is redefined. */
async function pickFile(name: string, body: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([body], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => {});
}

describe('App', () => {
  it('loads past the loading state, imports, and shows the range control with a custom range', async () => {
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {});
    expect(text()).not.toContain('Loading your history');
    expect(container.querySelector('input[type="file"]')).not.toBeNull();

    await pickFile('sample.csv', CSV);
    expect(text()).not.toContain('Import failed');

    // The range control lives on the analytical tabs; the import lands on one.
    await act(async () => button('Dashboard').click());
    expect(button('Custom')).toBeDefined();

    await act(async () => button('Custom').click());
    const dialog = container.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    // Only days with sessions are pickable, and the fixture has plenty.
    const enabled = [...dialog!.querySelectorAll('button[data-day]')].filter((b) => !(b as HTMLButtonElement).disabled);
    expect(enabled.length).toBeGreaterThan(0);
    // Still standing on the other side of every state change.
    expect(container.querySelector('header')).not.toBeNull();
    // The custom range went into the hash, replaced rather than pushed.
    expect(window.location.hash).toMatch(/^#dashboard\?range=\d{4}-\d{2}-\d{2}\.\.\d{4}-\d{2}-\d{2}$/);
    // ...and follows a tab switch.
    await act(async () => button('Sessions').click());
    expect(window.location.hash).toMatch(/^#sessions\?range=/);
    await act(async () => button('All').click());
    expect(window.location.hash).toBe('#sessions');
  });

  it('applies a range from the hash on a cold load', async () => {
    window.location.hash = '#dashboard?range=3m';
    await act(async () => {
      root.render(<App />);
    });
    await act(async () => {});
    await pickFile('sample.csv', CSV);
    await act(async () => button('Dashboard').click());
    expect(text()).toContain('(last 3 months)');
    expect(window.location.hash).toBe('#dashboard?range=3m');
  });
});
