// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Landing } from './Landing';
import { APP } from './parts';
import { TABS } from '../ui/tabs';

/**
 * The landing page is the site root, so the one thing that must never regress is
 * that it renders from nothing: no WorkoutDataProvider, no IndexedDB, no CSV.
 * This suite mounts it bare, which is the assertion.
 *
 * The link checks are the second half. Every CTA points into `/app.html#<tab>`,
 * and a hash that does not name a real tab silently drops the visitor on the
 * dashboard -- a dead-feeling bug that no type would catch, because these are
 * strings in markup.
 */

// Same flag the viz render suite sets: without it React logs an act() warning on
// every mount.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render() {
  act(() => root.render(<Landing />));
  return host;
}

const hrefs = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');

describe('Landing', () => {
  it('mounts with no provider and no stored data', () => {
    const el = render();
    expect(el.querySelector('h1')?.textContent).toContain('Every set');
  });

  it('links every app CTA at a tab that actually exists', () => {
    const ids = new Set<string>(TABS.map((t) => t.id));
    const appLinks = hrefs(render()).filter((h) => h.startsWith(APP));

    expect(appLinks.length, 'the landing must link into the app').toBeGreaterThan(0);
    for (const href of appLinks) {
      const hash = href.slice(APP.length);
      if (hash === '') continue; // the bare "open the app" link is fine
      expect(ids.has(hash.replace(/^#/, '')), href + ' names no tab').toBe(true);
    }
  });

  it('anchors every in-page nav link at a section that exists', () => {
    const el = render();
    for (const href of hrefs(el).filter((h) => h.startsWith('#'))) {
      expect(el.querySelector(href), href + ' has no target').not.toBeNull();
    }
  });

  it('ships a light and a dark capture for every screenshot', () => {
    const imgs = Array.from(render().querySelectorAll('img'));
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      // Both variants are in the markup and swapped by CSS, so the theme class
      // stamped before first paint decides -- no state, no hydration flicker.
      expect(img.getAttribute('src')).toMatch(/^\/shots\/.+-(light|dark)\.png$/);
      expect(img.getAttribute('alt')).toBeTruthy();
      // An unsized wide image reflows the whole page when it lands.
      expect(img.getAttribute('width')).toBeTruthy();
      expect(img.getAttribute('height')).toBeTruthy();
    }
  });

  it('ships every screenshot it references', () => {
    // A typo in a filename is a broken image in production and nothing else --
    // no type, no build step and no other test would catch it.
    // cwd, not import.meta.url: under jsdom that is an http: URL, not a file one.
    const pub = process.cwd() + '/public';
    for (const img of Array.from(render().querySelectorAll('img'))) {
      const src = img.getAttribute('src') ?? '';
      expect(existsSync(pub + src), 'public' + src + ' is missing').toBe(true);
    }
  });

  it('offers one app CTA in the hero, not two that do the same thing', () => {
    /*
     * The hero used to carry "Open the app" (#import) and "See the dashboard"
     * (#dashboard) side by side. For a first-time visitor -- which is everyone
     * a landing page is for -- `tabEnabled` sends #dashboard to Import, so the
     * two buttons rendered the identical screen and the second one lied about
     * where it went.
     *
     * The rule: at most one link into the app per call-to-action group, and any
     * second button beside it must be an in-page anchor.
     */
    const el = render();
    const hero = el.querySelector('h1')?.closest('section');
    expect(hero, 'no hero section').not.toBeNull();

    const links = Array.from(hero!.querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '');
    const intoApp = links.filter((h) => h.startsWith(APP));
    expect(intoApp, 'the hero should link into the app exactly once').toHaveLength(1);
    expect(intoApp[0]).toBe(APP + '#import');
  });

  it('never sends a first-time visitor to a tab that needs data', () => {
    // Every landing link into the app from a hero or a closing CTA must target a
    // tab that works on an empty app. The feature-tour links are exempt: they sit
    // beside a screenshot of the thing they name, and the app's own nav explains
    // the lock. This pins the entry points.
    const el = render();
    const openable = new Set<string>(TABS.filter((t) => !t.needsData).map((t) => t.id));

    for (const section of ['#top', '#get-started']) {
      const host = el.querySelector(section === '#top' ? '#top' : 'section:last-of-type');
      if (!host) continue;
      for (const a of Array.from(host.querySelectorAll('a'))) {
        const href = a.getAttribute('href') ?? '';
        if (!href.startsWith(APP)) continue;
        const tab = href.slice(APP.length).replace(/^#/, '');
        if (tab === '') continue;
        expect(openable.has(tab), href + ' needs data, so a new visitor lands elsewhere').toBe(true);
      }
    }
  });

  it('has exactly one h1', () => {
    expect(render().querySelectorAll('h1').length).toBe(1);
  });
});
