// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseCsv } from '../ingest/parseCsv';
import { buildMetaIndex } from '../meta/metaIndex';
import { guessMeta } from '../meta/guessMeta';
import { seedFor } from '../meta/seedMeta';
import { makeBodyweightResolver } from '../model/bodyweight';
import { enrichSets, type EnrichedSet } from '../model/effectiveLoad';
import { calendarDays, sessionBests, smoothSessionBests, bodyweightVsAddedSeries } from '../derive/series';
import { balanceSeries, volumeMatrix } from '../derive/balance';
import { habitMap, loadRepDensity, repDensity, setPositionProfile } from '../derive/profile';
import { cooccurrence } from '../derive/cooccurrence';
import { TrainingCalendar } from './TrainingCalendar';
import { SplitMatrix } from './SplitMatrix';
import { HabitHeatmap, MuscleHeatmap, DensityHeatmap } from './Heatmaps';
import {
  StackedVolume,
  ProgressionChart,
  BalanceChart,
  LoadSplitChart,
  SessionPeaksChart,
} from './TimeSeries';
import { RepHistogram, SetPositionChart } from './Distributions';
import { Sparkline, WeekdayBars } from './Insights';
import { findings } from '../derive/insights';
import type { ExerciseMeta } from '../model/types';
import { SAMPLE_FIXTURE } from '../test/fixtures';

/**
 * Mount smoke tests.
 *
 * These do not assert pixels -- SVG path snapshots break on every margin tweak
 * and assert nothing about correctness. They assert the thing that actually
 * matters and is otherwise invisible: every chart mounts without throwing, on a
 * full corpus AND on empty data.
 */

/**
 * jsdom has no layout engine: it has no ResizeObserver and every element measures
 * 0x0. ChartFrame deliberately renders nothing until it has a width, so without
 * both stubs these tests would only prove that charts render nothing.
 */
const TEST_WIDTH = 800;

/**
 * The plot is deliberately placed at a NON-ZERO viewport offset. With a rect at
 * (0,0) plot-local and viewport coordinates coincide, and the tooltip
 * positioning tests below could not tell the two apart -- which is precisely the
 * bug they exist to catch.
 */
const PLOT_LEFT = 300;
const PLOT_TOP = 400;

// Tells React that act() wrapping is intentional here.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class RO {
  constructor(private cb: ResizeObserverCallback) {}
  observe(_el: Element) {
    this.cb(
      [{ contentRect: { width: TEST_WIDTH, height: 240 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = RO;

Element.prototype.getBoundingClientRect = function (): DOMRect {
  return {
    width: TEST_WIDTH,
    height: 240,
    top: PLOT_TOP,
    left: PLOT_LEFT,
    right: PLOT_LEFT + TEST_WIDTH,
    bottom: PLOT_TOP + 240,
    x: PLOT_LEFT,
    y: PLOT_TOP,
    toJSON: () => ({}),
  } as DOMRect;
};

// HoverLayer throttles on rAF; run it synchronously so assertions are immediate.
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
  cb(0);
  return 0;
}) as typeof globalThis.requestAnimationFrame;
globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame;

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

function render(node: React.ReactNode) {
  act(() => root.render(node));
  return container;
}

// --- sample corpus --------------------------------------------------------------

// The synthetic sample, not the real export: this suite must run on a fresh
// clone, where the personal CSV is absent by design.
const text = readFileSync(SAMPLE_FIXTURE, 'utf8');
const parsed = parseCsv(text);
const meta: Record<string, ExerciseMeta> = {};
for (const s of parsed.sets) {
  if (!meta[s.exerciseName]) meta[s.exerciseName] = seedFor(s.exerciseName) ?? guessMeta(s.exerciseName);
}
const lookup = (n: string) => meta[n];
const sets = enrichSets(parsed.sets, buildMetaIndex(meta), makeBodyweightResolver([{ date: '2023-01-01', kg: 80 }], 80));

const EMPTY: EnrichedSet[] = [];

describe('charts mount on the sample corpus', () => {
  it('training calendar', () => {
    const el = render(<TrainingCalendar days={calendarDays(sets)} unit="kg" />);
    expect(el.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('rect').length).toBeGreaterThan(100);
  });

  it('co-occurrence matrix', () => {
    const el = render(<SplitMatrix result={cooccurrence(sets, lookup)} />);
    expect(el.querySelectorAll('rect').length).toBeGreaterThan(50);
  });

  it('muscle heatmap in both scale modes', () => {
    const mx = volumeMatrix(sets, lookup, { granularity: 'week', by: 'muscle' });
    expect(render(<MuscleHeatmap matrix={mx} unit="kg" scaleMode="relative" />).querySelectorAll('rect').length).toBeGreaterThan(10);
    expect(render(<MuscleHeatmap matrix={mx} unit="kg" scaleMode="absolute" />).querySelectorAll('rect').length).toBeGreaterThan(10);
  });

  it('habit heatmap', () => {
    const el = render(<HabitHeatmap habit={habitMap(sets)} weekStartsOn={1} />);
    expect(el.querySelectorAll('rect').length).toBeGreaterThan(10);
  });

  it('stacked volume', () => {
    const mx = volumeMatrix(sets, lookup, { granularity: 'month', by: 'muscle' });
    expect(render(<StackedVolume matrix={mx} unit="kg" />).querySelectorAll('svg').length).toBe(1);
  });

  it('balance chart', () => {
    const b = balanceSeries(sets, lookup, { granularity: 'month' });
    expect(render(<BalanceChart points={b} metric="pullPushLog2" labels={['pull', 'push']} />).querySelectorAll('svg').length).toBe(1);
  });

  it('rep histogram', () => {
    expect(render(<RepHistogram bins={repDensity(sets)} />).querySelectorAll('svg').length).toBe(1);
  });

  it('per-session peaks chart', () => {
    // Squat is the stress case in the sample too: it carries empty-bar sets and
    // sits either side of the deliberate layoff the generator inserts.
    const squats = sets.filter((s) => s.canonicalName === 'Squat (Barbell)');
    expect(squats.length).toBeGreaterThan(0);

    const bests = sessionBests(squats);
    expect(bests.length).toBeGreaterThan(5);
    // Both series must carry signal, or there is no reason to plot two facets.
    expect(bests.some((b) => (b.heaviestKg ?? 0) > 0)).toBe(true);
    expect(bests.some((b) => b.volumeKg > 0)).toBe(true);

    const el = render(<SessionPeaksChart points={bests} unit="kg" />);
    expect(el.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(el.querySelectorAll('circle').length).toBeGreaterThan(10);
    expect(el.querySelectorAll('rect').length).toBeGreaterThan(10);
  });

  it('per-exercise charts for Pull Up', () => {
    const pullUps = sets.filter((s) => s.canonicalName === 'Pull Up');
    expect(pullUps.length).toBeGreaterThan(0);

    render(<ProgressionChart points={smoothSessionBests(sessionBests(pullUps))} unit="kg" />);
    render(<DensityHeatmap density={loadRepDensity(pullUps)} unit="kg" />);
    render(<SetPositionChart profile={setPositionProfile(pullUps)} unit="kg" />);
    render(
      <LoadSplitChart points={bodyweightVsAddedSeries(pullUps, { granularity: 'month' })} unit="kg" />,
    );
    expect(container).toBeTruthy();
  });
});

// --- degenerate inputs --------------------------------------------------------

describe('insight charts', () => {
  const rates = [
    { weekday: 0, trained: 20, available: 50 },
    { weekday: 1, trained: 18, available: 50 },
    { weekday: 2, trained: 22, available: 50 },
    { weekday: 3, trained: 19, available: 50 },
    { weekday: 4, trained: 21, available: 50 },
    { weekday: 5, trained: 3, available: 50 },
    { weekday: 6, trained: 17, available: 50 },
  ];

  it('weekday bars draw a bar per day plus the reference line', () => {
    const el = render(<WeekdayBars rates={rates} overall={0.28} flagged={5} weekStartsOn={1} />);
    expect(el.querySelectorAll('rect').length).toBeGreaterThanOrEqual(7);
    // The dashed comparison line is the whole point of the chart.
    expect(el.querySelector('line[stroke-dasharray]')).toBeTruthy();
  });

  it('weekday bars respect the week-start setting', () => {
    // `render` reuses one container, so each variant must be read before the
    // next render replaces it. The axis tick labels come first in document
    // order, hence selecting the centred category labels specifically.
    const firstColumn = (weekStartsOn: 0 | 1) =>
      render(
        <WeekdayBars rates={rates} overall={0.28} flagged={5} weekStartsOn={weekStartsOn} />,
      ).querySelector('text[text-anchor="middle"]')?.textContent;

    expect(firstColumn(1)).toBe('Mon');
    expect(firstColumn(0)).toBe('Sun');
  });

  it('sparkline draws the series and the fitted line', () => {
    const el = render(<Sparkline values={[5, 4, 4, 3, 2]} trend={[5, 2]} label="test" />);
    expect(el.querySelectorAll('path').length).toBeGreaterThan(0);
    expect(el.querySelector('line[stroke-dasharray]')).toBeTruthy();
  });

  it('sparkline refuses a single point rather than drawing nothing', () => {
    const el = render(<Sparkline values={[5]} label="test" />);
    expect(el.querySelectorAll('svg').length).toBe(0);
    expect(el.textContent).toMatch(/at least 2/);
  });

  /** Every chart payload the engine emits must be renderable. */
  it('renders whatever the engine attaches to a finding', () => {
    const r = findings(sets, lookup, { weekStartsOn: 1 });
    for (const f of r.findings) {
      if (!f.chart) continue;
      const el =
        f.chart.type === 'weekday'
          ? render(
              <WeekdayBars
                rates={f.chart.rates}
                overall={f.chart.overall}
                flagged={f.chart.flagged}
                weekStartsOn={1}
              />,
            )
          : render(
              <Sparkline
                values={f.chart.values}
                trend={f.chart.trend ?? undefined}
                label={f.title}
              />,
            );
      expect(el).toBeTruthy();
    }
  });
});

describe('charts survive empty and tiny data', () => {
  it('renders an explanation rather than an empty frame when there is nothing', () => {
    const el = render(<TrainingCalendar days={[]} unit="kg" />);
    expect(el.textContent).toContain('Import');
  });

  it('mounts every chart on an empty corpus without throwing', () => {
    const mx = volumeMatrix(EMPTY, lookup, { granularity: 'week', by: 'muscle' });
    render(<MuscleHeatmap matrix={mx} unit="kg" />);
    render(<StackedVolume matrix={mx} unit="kg" />);
    render(<HabitHeatmap habit={habitMap(EMPTY)} weekStartsOn={1} />);
    render(<RepHistogram bins={repDensity(EMPTY)} />);
    render(<DensityHeatmap density={loadRepDensity(EMPTY)} unit="kg" />);
    render(<SetPositionChart profile={setPositionProfile(EMPTY)} unit="kg" />);
    render(<SplitMatrix result={cooccurrence(EMPTY, lookup)} />);
    render(<ProgressionChart points={smoothSessionBests(sessionBests(EMPTY))} unit="kg" />);
    render(
      <BalanceChart
        points={balanceSeries(EMPTY, lookup, { granularity: 'month' })}
        metric="pullPushLog2"
        labels={['pull', 'push']}
      />,
    );
    render(<LoadSplitChart points={bodyweightVsAddedSeries(EMPTY, { granularity: 'month' })} unit="kg" />);
    render(<SessionPeaksChart points={sessionBests(EMPTY)} unit="kg" />);
    expect(container).toBeTruthy();
  });

  it('mounts on a single-session corpus', () => {
    const one = sets.filter((s) => s.workoutId === sets[0]?.workoutId);
    render(<TrainingCalendar days={calendarDays(one)} unit="kg" />);
    render(<SplitMatrix result={cooccurrence(one, lookup)} />);
    render(<ProgressionChart points={smoothSessionBests(sessionBests(one))} unit="kg" />);
    render(<SessionPeaksChart points={sessionBests(one)} unit="kg" />);
    expect(container).toBeTruthy();
  });

  it('falls back to a weekday chart when the export has no time of day', () => {
    const midnight = sets.slice(0, 50).map((s) => ({
      ...s,
      date: new Date(s.date.getFullYear(), s.date.getMonth(), s.date.getDate()),
    }));
    const el = render(<HabitHeatmap habit={habitMap(midnight)} weekStartsOn={1} />);
    expect(el.textContent).toContain('no time-of-day');
  });
});

// --- tooltip positioning ------------------------------------------------------

/**
 * Regression guard for a real bug: the tooltip is `position: fixed`, so it must be
 * positioned with VIEWPORT coordinates. HoverLayer computes plot-LOCAL coordinates
 * for hit-testing, and the call sites originally passed those straight through
 * plus a hardcoded fudge. The result sat at a constant offset from the window
 * corner, drifting further from the cursor the further down the page the chart
 * was. Every existing mount test passed throughout, because they only assert that
 * a chart renders -- never where anything lands.
 */
function tooltipEl(): HTMLElement | null {
  return document.body.querySelector('div.fixed.z-50');
}

function pxOf(el: HTMLElement, prop: 'left' | 'top'): number | null {
  const v = el.style[prop];
  return v === '' ? null : parseFloat(v);
}

const PAD = 14;

describe('tooltips follow the cursor', () => {
  it('HoverLayer charts position against the viewport, not the plot origin', () => {
    const points = balanceSeries(sets, lookup, { granularity: 'month' });
    const el = render(
      <BalanceChart points={points} metric="pullPushLog2" labels={['pull', 'push']} />,
    );

    const hoverRect = el.querySelector('rect[fill="transparent"]');
    expect(hoverRect, 'BalanceChart should mount a HoverLayer').toBeTruthy();

    // A cursor well inside the plot, at a position where local and viewport differ.
    const clientX = PLOT_LEFT + 200;
    const clientY = PLOT_TOP + 100;

    act(() => {
      hoverRect!.dispatchEvent(
        new MouseEvent('pointermove', { bubbles: true, clientX, clientY }),
      );
    });

    const tip = tooltipEl();
    expect(tip, 'a tooltip should appear on hover').toBeTruthy();

    const left = pxOf(tip!, 'left');
    const top = pxOf(tip!, 'top');
    expect(left).not.toBeNull();
    expect(top).not.toBeNull();

    // The fix: anchored to the cursor in viewport space.
    expect(left).toBeCloseTo(clientX + PAD, 0);
    expect(top).toBeCloseTo(clientY + PAD, 0);

    // The bug: local coords would have landed near the plot origin instead.
    expect(Math.abs((left as number) - (clientX - PLOT_LEFT))).toBeGreaterThan(100);
  });

  it('the per-session peaks chart honours the same contract', () => {
    const squats = sets.filter((s) => s.canonicalName === 'Squat (Barbell)');
    const el = render(<SessionPeaksChart points={sessionBests(squats)} unit="kg" />);

    const hoverRect = el.querySelector('rect[fill="transparent"]');
    expect(hoverRect, 'SessionPeaksChart should mount a HoverLayer').toBeTruthy();

    const clientX = PLOT_LEFT + 250;
    const clientY = PLOT_TOP + 120;
    act(() => {
      hoverRect!.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
    });

    const tip = tooltipEl();
    expect(tip).toBeTruthy();
    expect(pxOf(tip!, 'left')).toBeCloseTo(clientX + PAD, 0);
    expect(pxOf(tip!, 'top')).toBeCloseTo(clientY + PAD, 0);
  });

  it('per-mark charts position against the viewport too', () => {
    const el = render(<TrainingCalendar days={calendarDays(sets)} unit="kg" />);
    const cell = el.querySelector('rect[rx="2"]');
    expect(cell).toBeTruthy();

    const clientX = 640;
    const clientY = 720;
    act(() => {
      cell!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX, clientY }));
    });

    const tip = tooltipEl();
    expect(tip).toBeTruthy();
    expect(pxOf(tip!, 'left')).toBeCloseTo(clientX + PAD, 0);
  });

  it('flips instead of clamping near the right and bottom edges', () => {
    const points = balanceSeries(sets, lookup, { granularity: 'month' });
    const el = render(
      <BalanceChart points={points} metric="pullPushLog2" labels={['pull', 'push']} />,
    );
    const hoverRect = el.querySelector('rect[fill="transparent"]')!;

    // Near the bottom-right corner of the viewport.
    const clientX = window.innerWidth - 20;
    const clientY = window.innerHeight - 20;
    act(() => {
      hoverRect.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX, clientY }));
    });

    const tip = tooltipEl();
    expect(tip).toBeTruthy();
    // Both axes anchor the opposite edge, so nothing is pushed off screen.
    expect(tip!.style.left).toBe('');
    expect(tip!.style.top).toBe('');
    expect(tip!.style.right).not.toBe('');
    expect(tip!.style.bottom).not.toBe('');
  });
});
