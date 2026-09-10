import { describe, it, expect } from 'vitest';
import {
  comparisonToMarkdown,
  sharedLiftsToCsv,
  EXCLUDED_COPY,
  EXCLUDED_TITLE,
} from './compareReport';
import type { Comparison, Excluded, LiftRow, Shape } from './compare';

/**
 * The export is the comparison as a document. What matters is that it carries
 * the REFUSALS: a file listing only the lifts that compared would read as a
 * complete picture of two people, which is exactly the claim the tab exists to
 * avoid making.
 */

const EXCLUDED_REASONS: Excluded[] = [
  'machine-or-cable',
  'unknown-equipment',
  'needs-bodyweight',
  'not-enough-history',
];

function shape(label: string): Shape {
  return {
    label,
    sessions: 40,
    weeks: 20,
    sessionsPerWeek: 2,
    setsPerSession: 18.5,
    volumePerWeekKg: 12_000,
    medianSessionMinutes: null,
    muscleShare: [{ group: 'chest', share: 0.4 }],
    reps: [{ reps: 8, setCount: 30 }],
    from: new Date(2025, 0, 6),
    to: new Date(2025, 4, 26),
  };
}

function lift(over: Partial<LiftRow> = {}): LiftRow {
  return {
    name: 'Bench Press (Barbell)',
    equipment: 'barbell',
    youKg: 100,
    themKg: 110,
    youPeakKg: 105,
    themPeakKg: 118,
    youSessions: 20,
    themSessions: 12,
    ratio: 1.1,
    relativeRatio: 1.05,
    series: { you: [], them: [] },
    ...over,
  };
}

function comparison(over: Partial<Comparison> = {}): Comparison {
  return {
    you: shape('You'),
    them: shape('Alex'),
    sharedNames: ['Bench Press (Barbell)', 'Leg Press'],
    yoursOnly: ['Face Pull'],
    theirsOnly: ['Sled Push'],
    lifts: [lift()],
    excluded: [{ name: 'Leg Press', reason: 'machine-or-cable' }],
    slopes: [
      { name: 'Bench Press (Barbell)', youKgPerMonth: 0.8, themKgPerMonth: 1.6, significant: true },
    ],
    theyDoYouDont: [{ name: 'Sled Push', sessions: 9 }],
    bodyweightKnown: true,
    ...over,
  };
}

const OPTS = { unit: 'kg', scale: 'absolute', yourKg: 82, themKg: 78 } as const;

describe('comparisonToMarkdown', () => {
  it('carries the headline counts and both names', () => {
    const md = comparisonToMarkdown(comparison(), OPTS);
    expect(md).toContain('# You vs Alex');
    expect(md).toContain('| Lifts compared | 1 |');
    expect(md).toContain('| Only Alex | 1 |');
  });

  /** The whole point of the document. */
  it('names every refused lift with its reason', () => {
    const md = comparisonToMarkdown(comparison(), OPTS);
    expect(md).toContain(EXCLUDED_TITLE['machine-or-cable']);
    expect(md).toContain(EXCLUDED_COPY['machine-or-cable']);
    expect(md).toContain('Leg Press');
  });

  it('states both bodyweights, because every ratio depends on them', () => {
    const md = comparisonToMarkdown(comparison(), OPTS);
    expect(md).toContain('- You: 82.0 kg');
    expect(md).toContain('- Alex: 78.0 kg');
  });

  it('says so, loudly, when a bodyweight is missing', () => {
    const md = comparisonToMarkdown(comparison({ bodyweightKnown: false }), {
      ...OPTS,
      themKg: null,
    });
    expect(md).toContain('- Alex: not recorded');
    expect(md).toContain('Bodyweight movements were left out entirely');
  });

  it('converts to pounds when that is the display unit', () => {
    const md = comparisonToMarkdown(comparison(), { ...OPTS, unit: 'lb' });
    expect(md).toContain('| Bench Press (Barbell) | 220.5 | 242.5 |');
  });

  it('reports the per-kg ratio when the tab is on that scale', () => {
    const md = comparisonToMarkdown(comparison(), { ...OPTS, scale: 'relative' });
    expect(md).toContain('Ratio (per kg)');
    expect(md).toContain('1.05×');
  });

  /** An empty comparison is a real state -- two people who share nothing. */
  it('does not pretend an empty comparison has content', () => {
    const md = comparisonToMarkdown(
      comparison({ lifts: [], excluded: [], slopes: [], theyDoYouDont: [], sharedNames: [] }),
      OPTS,
    );
    expect(md).toContain('Nothing survived every gate');
    expect(md).toContain('Nothing was refused.');
    expect(md).not.toContain('Who is moving faster');
  });

  it('has copy for every exclusion reason there is', () => {
    for (const reason of EXCLUDED_REASONS) {
      expect(EXCLUDED_TITLE[reason]).toBeTruthy();
      expect(EXCLUDED_COPY[reason]).toBeTruthy();
    }
  });
});

describe('sharedLiftsToCsv', () => {
  it('quotes names, which routinely carry commas and parentheses', () => {
    const csv = sharedLiftsToCsv(
      comparison({ lifts: [lift({ name: 'Row, Bent Over (Barbell)' })] }),
      OPTS,
    );
    expect(csv).toContain('"Row, Bent Over (Barbell)"');
  });

  it('escapes a quote inside a name by doubling it', () => {
    const csv = sharedLiftsToCsv(comparison({ lifts: [lift({ name: 'Farmer’s "Walk"' })] }), OPTS);
    expect(csv).toContain('"Farmer’s ""Walk"""');
  });

  it('leaves the per-kg column empty rather than guessing when unknown', () => {
    const csv = sharedLiftsToCsv(comparison({ lifts: [lift({ relativeRatio: null })] }), OPTS);
    const row = csv.split('\r\n')[1] as string;
    expect(row).toContain(',1.100,,');
  });

  it('is a header and one row per compared lift, CRLF terminated', () => {
    const csv = sharedLiftsToCsv(comparison(), OPTS);
    const lines = csv.split('\r\n').filter((l) => l !== '');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('"Alex (kg)"');
  });
});
