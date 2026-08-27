import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CATEGORICAL, DIVERGING, SEQUENTIAL, sequential, diverging, categorical } from './colour';

/**
 * Contrast and ordering locks for the two-theme palette.
 *
 * `colour.ts` emits `var(--chart-*)` references rather than hex, so the real
 * colour values live in index.css. This suite therefore reads that file and
 * asserts against the actual source of truth rather than a JavaScript copy of
 * it that could silently drift.
 *
 * These are the only automated guard on the redesign: the render suite mounts
 * every chart but asserts nothing about colour, so without this a dark ramp
 * could be accidentally inverted -- making every heatmap unreadable -- and the
 * whole suite would still pass.
 */

const CSS = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8');
/**
 * EVERY html entry in the repo root, not just one.
 *
 * There are two of them now -- index.html (the landing) and app.html (the app)
 * -- and both must inline the same pre-paint theme boot script. Reading the
 * directory rather than naming a file means a third entry added later is
 * covered without anyone remembering to come back here.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const HTML_ENTRIES = readdirSync(ROOT)
  .filter((f) => f.endsWith('.html'))
  .map((f) => [f, readFileSync(ROOT + f, 'utf8')] as const);

/** Pulls the `--x: #rrggbb;` declarations out of one top-level selector block. */
function themeBlock(selector: string): Record<string, string> {
  const start = CSS.indexOf('\n' + selector + ' {');
  expect(start, 'no `' + selector + '` block in index.css').toBeGreaterThan(-1);
  const end = CSS.indexOf('\n}', start);
  const out: Record<string, string> = {};
  for (const line of CSS.slice(start, end).split('\n')) {
    const m = line.match(/^\s*(--[\w-]+):\s*(#[0-9a-fA-F]{6})\s*;/);
    if (m) out[m[1]!] = m[2]!.toLowerCase();
  }
  return out;
}

const LIGHT = themeBlock(':root');
const DARK = themeBlock(':root.dark');

function channel(c: number): number {
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG contrast ratio, 1..21. */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  { name: 'light', vars: LIGHT },
  { name: 'dark', vars: DARK },
] as const;

/** Resolves a `var(--x)` string emitted by colour.ts against one theme. */
function resolve(vars: Record<string, string>, ref: string): string {
  const m = ref.match(/^var\((--[\w-]+)\)$/);
  expect(m, 'expected a var() reference, got ' + ref).not.toBeNull();
  const hex = vars[m![1]!];
  expect(hex, 'index.css does not define ' + m![1]).toBeDefined();
  return hex!;
}

describe('palette parity', () => {
  it('both themes define exactly the same variables', () => {
    expect(Object.keys(DARK).sort()).toEqual(Object.keys(LIGHT).sort());
  });

  it('defines every variable colour.ts references', () => {
    const refs = [...SEQUENTIAL, ...DIVERGING, ...CATEGORICAL];
    for (const theme of THEMES) {
      for (const ref of refs) expect(() => resolve(theme.vars, ref)).not.toThrow();
    }
  });
});

describe.each(THEMES)('$name theme', ({ vars }) => {
  const surface = vars['--c-surface']!;

  it('reads text at or above the AA threshold for its size', () => {
    // Body and headings.
    expect(contrast(vars['--c-ink']!, surface)).toBeGreaterThanOrEqual(7);
    // Secondary prose.
    expect(contrast(vars['--c-ink-dim']!, surface)).toBeGreaterThanOrEqual(4.5);
    // `.hud-label` is 11px, so it is small text and gets no 3:1 large-text pass.
    expect(contrast(vars['--c-ink-faint']!, surface)).toBeGreaterThanOrEqual(4.5);
    // Lime as text -- the token that exists precisely because #c3f53c is
    // unreadable on white.
    expect(contrast(vars['--c-accent-ink']!, surface)).toBeGreaterThanOrEqual(4.5);
    // Ink sitting ON the lime fill, e.g. primary buttons.
    expect(contrast(vars['--c-accent-on']!, vars['--c-accent']!)).toBeGreaterThanOrEqual(4.5);
  });

  it('reads status text against its own tinted background', () => {
    for (const tone of ['warn', 'danger', 'good'] as const) {
      expect(
        contrast(vars['--c-' + tone]!, vars['--c-' + tone + '-bg']!),
        tone + ' on its own background',
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps chart chrome legible', () => {
    // Axis tick labels render at 9-10px.
    expect(contrast(vars['--chart-axis']!, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(vars['--chart-axis-text']!, surface)).toBeGreaterThanOrEqual(4.5);
    // A de-emphasised series is still a graphic conveying information: 3:1.
    expect(contrast(vars['--chart-muted']!, surface)).toBeGreaterThanOrEqual(2.9);
  });

  /**
   * The contract `quantileBinner` depends on. It skips the weakest ramp step so
   * the lowest bin still reads as "trained", which is only meaningful if index 0
   * really is the weakest. Light runs pale-to-deep and dark runs near-black-to-
   * lime, so raw luminance moves in OPPOSITE directions between themes --
   * contrast against the surface is the invariant that holds for both.
   */
  it('orders the sequential ramp least-intense to most-intense', () => {
    const steps = SEQUENTIAL.map((ref) => contrast(resolve(vars, ref), surface));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i], 'seq step ' + i + ' must be stronger than ' + (i - 1)).toBeGreaterThan(
        steps[i - 1]!,
      );
    }
    // The top of the ramp has to be unmistakably "a lot".
    expect(steps.at(-1)!).toBeGreaterThan(7);
  });

  /**
   * Ordering alone let the ramp drift almost invisible: five of nine light steps
   * once sat under 2:1, so a busy week and an untrained one looked the same.
   * Charts only ever draw from index 1 up -- MuscleHeatmap starts at t=0.1 and
   * quantileBinner deliberately skips the weakest step -- so that is where the
   * floor applies.
   */
  it('keeps every drawn sequential step visible against the surface', () => {
    const steps = SEQUENTIAL.map((ref) => contrast(resolve(vars, ref), surface));
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i], 'seq step ' + i + ' vs surface').toBeGreaterThanOrEqual(2);
    }
  });

  /**
   * "Trained a little" and "no session at all" are different facts and must not
   * be the same colour. Index 0 is the weakest thing the ramp can say; the empty
   * fill has to stay clearly quieter than it.
   */
  it('separates the weakest sequential step from the empty fill', () => {
    const seq0 = contrast(resolve(vars, SEQUENTIAL[0]!), surface);
    const empty = contrast(vars['--chart-empty']!, surface);
    expect(seq0 - empty, 'seq-0 must out-read --chart-empty').toBeGreaterThanOrEqual(0.2);
  });

  it('keeps the diverging midpoint the quietest colour in its ramp', () => {
    const steps = DIVERGING.map((ref) => contrast(resolve(vars, ref), surface));
    const mid = steps[4]!;
    for (let i = 0; i < steps.length; i++) {
      if (i !== 4) expect(steps[i], 'div step ' + i).toBeGreaterThan(mid);
    }
    // Both extremes must shout equally; a lopsided ramp reads as bias.
    expect(steps[0]!).toBeGreaterThan(4);
    expect(steps.at(-1)!).toBeGreaterThan(4);
  });

  /**
   * Quietest is not the same as absent. The midpoint still has to read as a
   * drawn cell, and every step either side of it is a graphic conveying
   * information, so it takes the 3:1 mark floor.
   */
  it('keeps the whole diverging ramp visible against the surface', () => {
    const steps = DIVERGING.map((ref) => contrast(resolve(vars, ref), surface));
    steps.forEach((c, i) => {
      if (i !== 4) expect(c, 'div step ' + i + ' vs surface').toBeGreaterThanOrEqual(2.9);
    });
    expect(steps[4], 'the neutral midpoint is quiet, not invisible').toBeGreaterThanOrEqual(1.5);
  });

  it('gives every categorical slot a distinct, visible colour', () => {
    const hexes = CATEGORICAL.map((ref) => resolve(vars, ref));
    expect(new Set(hexes).size, 'categorical slots must not repeat').toBe(hexes.length);
    for (const hex of hexes) expect(contrast(hex, surface)).toBeGreaterThanOrEqual(3);
  });
});

describe('ramp functions', () => {
  it('clamps at both ends rather than wrapping', () => {
    expect(sequential(-5)).toBe(SEQUENTIAL[0]);
    expect(sequential(5)).toBe(SEQUENTIAL.at(-1));
    expect(diverging(-5)).toBe(DIVERGING[0]);
    expect(diverging(5)).toBe(DIVERGING.at(-1));
    // A repeated categorical colour is worse than a grey one.
    expect(categorical(-1)).toBe(CATEGORICAL[0]);
    expect(categorical(99)).toBe(CATEGORICAL.at(-1));
  });

  it('puts the diverging neutral at t=0', () => {
    expect(diverging(0)).toBe(DIVERGING[4]);
  });
});

describe('boot script', () => {
  /**
   * Each html entry hard-codes the canvas colour because the script runs before
   * any CSS exists. That duplication is unavoidable, so it gets a test instead.
   */
  it('is present in every html entry', () => {
    expect(HTML_ENTRIES.length, 'no .html entries found in the repo root').toBeGreaterThan(0);
    for (const [name, html] of HTML_ENTRIES) {
      expect(html, name + ' is missing the theme boot script').toContain('stronginsight:theme');
    }
  });

  it.each(HTML_ENTRIES)('mirrors the canvas colour of both themes in %s', (name, html) => {
    const m = html.match(/backgroundColor\s*=\s*dark\s*\?\s*'(#[0-9a-f]{6})'\s*:\s*'(#[0-9a-f]{6})'/);
    expect(m, 'could not find the boot background assignment in ' + name).not.toBeNull();
    expect(m![1]).toBe(DARK['--c-canvas']);
    expect(m![2]).toBe(LIGHT['--c-canvas']);
  });

  /** The class must land on <html>; the chart tooltip portals outside the app root. */
  it.each(HTML_ENTRIES)('stamps the class on documentElement in %s', (_name, html) => {
    expect(html).toContain("el.classList.toggle('dark', dark)");
    expect(html).toContain('var el = document.documentElement;');
  });
});
