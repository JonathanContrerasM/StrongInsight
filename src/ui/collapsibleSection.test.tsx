// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { CollapsibleSection } from './primitives';
import { COLLAPSE_KEY } from './collapse';

/**
 * A folded section must stay folded across a reload, and a browser that refuses
 * storage must still get a working page -- open, and foldable for the visit.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Node 25+ ships its own global `localStorage`, undefined unless started with a
 * storage file, and it shadows jsdom's. A Map-backed stand-in gives these tests
 * the browser's behaviour.
 */
class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, String(v));
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  clear() {
    this.m.clear();
  }
}
const storage = new MemoryStorage();
Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function mount() {
  act(() =>
    root.render(
      <CollapsibleSection id="test.records" label="Records" actions={<span>chip</span>}>
        <p>body</p>
      </CollapsibleSection>,
    ),
  );
}

const header = () => container.querySelector('button[aria-expanded]') as HTMLButtonElement;
const text = () => container.textContent ?? '';

describe('CollapsibleSection', () => {
  it('starts open', () => {
    mount();
    expect(header().getAttribute('aria-expanded')).toBe('true');
    expect(text()).toContain('body');
  });

  it('folds and unfolds from its heading, keeping the actions visible', () => {
    mount();
    act(() => header().click());
    expect(header().getAttribute('aria-expanded')).toBe('false');
    expect(text()).not.toContain('body');
    expect(text()).toContain('chip');
    act(() => header().click());
    expect(text()).toContain('body');
  });

  it('remembers a fold across a remount', () => {
    mount();
    act(() => header().click());
    expect(JSON.parse(localStorage.getItem(COLLAPSE_KEY)!)).toEqual(['test.records']);
    act(() => root.unmount());
    root = createRoot(container);
    mount();
    expect(text()).not.toContain('body');
  });

  it('treats unreadable storage as all open', () => {
    localStorage.setItem(COLLAPSE_KEY, '{not json');
    mount();
    expect(text()).toContain('body');
  });

  it('still works for the visit when storage throws', () => {
    vi.spyOn(storage, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    expect(text()).toContain('body');
    act(() => header().click());
    expect(text()).not.toContain('body');
  });
});
