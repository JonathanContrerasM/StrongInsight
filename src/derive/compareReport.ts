import type { Comparison, Excluded } from './compare';
import type { CompareScale, WeightUnit } from '../model/types';

/**
 * The comparison as a document you can keep.
 *
 * Pure: strings in, strings out, no React and no IO, which is the rule for
 * everything in `derive/`. The download mechanics live in `ui/download.ts`.
 *
 * The exclusion copy below is the SAME copy the tab renders -- the view imports
 * it from here. A second copy would drift, and the exported file would start
 * refusing comparisons for reasons the screen no longer gives.
 */

export const EXCLUDED_TITLE: Record<Excluded, string> = {
  'machine-or-cable': 'Not comparable across gyms',
  'unknown-equipment': 'Equipment not stated',
  'needs-bodyweight': 'Needs both bodyweights',
  'not-enough-history': 'Not enough shared history',
};

export const EXCLUDED_COPY: Record<Excluded, string> = {
  'machine-or-cable':
    'Machine and cable loads are not a shared unit. 60 kg on one manufacturer’s stack is not 60 kg on another’s, and a cable’s label depends on the pulley ratio.',
  'unknown-equipment':
    'The export does not say what equipment these use, so whether the load is comparable cannot be checked. Strong only states it in a trailing parenthetical.',
  'needs-bodyweight':
    'These are bodyweight movements. The load is the lifter’s own body, so both bodyweights are needed before the numbers mean the same thing.',
  'not-enough-history':
    'Fewer than three sessions with a usable estimate on one side or the other.',
};

export type ReportOptions = {
  unit: WeightUnit;
  scale: CompareScale;
  /** Both bodyweights, because every ratio in the document depends on them. */
  yourKg: number | null;
  themKg: number | null;
};

const LB_PER_KG = 1 / 0.45359237;

/**
 * Kept local rather than imported from `format.ts`: that module rounds for
 * display and appends a unit, and a document that will be pasted into a
 * spreadsheet wants a bare number at a fixed precision.
 */
function w(kg: number, unit: WeightUnit): string {
  const v = unit === 'lb' ? kg * LB_PER_KG : kg;
  return v.toFixed(1);
}

function isoDay(d: Date | null): string {
  if (!d) return '—';
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function bodyweightLine(label: string, kg: number | null, unit: WeightUnit): string {
  return '- ' + label + ': ' + (kg === null ? 'not recorded' : w(kg, unit) + ' ' + unit);
}

export function comparisonToMarkdown(c: Comparison, opts: ReportOptions): string {
  const { unit, scale } = opts;
  const them = c.them.label;
  const ratioHeading = scale === 'relative' ? 'Ratio (per kg)' : 'Ratio';
  const out: string[] = [];

  out.push('# You vs ' + them);
  out.push('');
  out.push(
    'You share ' +
      c.sharedNames.length +
      ' exercises, of which ' +
      c.lifts.length +
      ' carry enough history on both sides in a form where load means the same thing in two ' +
      'different gyms. The rest are listed below with the reason rather than folded into an average.',
  );
  out.push('');
  out.push('| | Count |');
  out.push('| --- | ---: |');
  out.push('| Lifts compared | ' + c.lifts.length + ' |');
  out.push('| Shared, not comparable | ' + c.excluded.length + ' |');
  out.push('| Only you | ' + c.yoursOnly.length + ' |');
  out.push('| Only ' + them + ' | ' + c.theirsOnly.length + ' |');
  out.push('');

  out.push('## Bodyweight');
  out.push('');
  out.push(bodyweightLine('You', opts.yourKg, unit));
  out.push(bodyweightLine(them, opts.themKg, unit));
  if (!c.bodyweightKnown) {
    out.push('');
    out.push(
      '> Bodyweight movements were left out entirely, and no per-kg figure below is populated: ' +
        'both bodyweights are needed before a pull up means the same thing for two people.',
    );
  }
  out.push('');

  out.push('## Shared lifts');
  out.push('');
  if (c.lifts.length === 0) {
    out.push('Nothing survived every gate. See what was left out, below.');
  } else {
    out.push(
      'The headline is each side’s typical top set — the median of their best set per session. ' +
        'A personal best is a maximum over a sample, so it climbs with the number of attempts ' +
        'logged rather than with strength; the best column carries its session count for that reason.',
    );
    out.push('');
    out.push(
      '| Lift | You (' + unit + ') | ' + them + ' (' + unit + ') | ' + ratioHeading +
        ' | Your best | Their best |',
    );
    out.push('| --- | ---: | ---: | ---: | ---: | ---: |');
    for (const l of c.lifts) {
      const r = scale === 'relative' ? l.relativeRatio : l.ratio;
      out.push(
        '| ' +
          l.name +
          ' | ' +
          w(l.youKg, unit) +
          ' | ' +
          w(l.themKg, unit) +
          ' | ' +
          (r === null ? '—' : r.toFixed(2) + '×') +
          ' | ' +
          w(l.youPeakKg, unit) +
          ' (' +
          l.youSessions +
          ') | ' +
          w(l.themPeakKg, unit) +
          ' (' +
          l.themSessions +
          ') |',
      );
    }
  }
  out.push('');

  out.push('## What was left out, and why');
  out.push('');
  const byReason = new Map<Excluded, string[]>();
  for (const e of c.excluded) {
    const list = byReason.get(e.reason);
    if (list) list.push(e.name);
    else byReason.set(e.reason, [e.name]);
  }
  if (byReason.size === 0) {
    out.push('Nothing was refused.');
  } else {
    for (const [reason, names] of byReason) {
      out.push('### ' + EXCLUDED_TITLE[reason] + ' (' + names.length + ')');
      out.push('');
      out.push(EXCLUDED_COPY[reason]);
      out.push('');
      out.push(names.join(', '));
      out.push('');
    }
  }

  if (c.slopes.length > 0) {
    out.push('## Who is moving faster');
    out.push('');
    out.push(
      'Rate of change is the fairest cross-person number: it does not care who started stronger. ' +
        'Comparing ' +
        c.slopes.length +
        ' lifts is ' +
        c.slopes.length +
        ' tests, so only differences that survive a correction for that are marked as real.',
    );
    out.push('');
    out.push('| Lift | You (kg/mo) | ' + them + ' (kg/mo) | |');
    out.push('| --- | ---: | ---: | --- |');
    for (const s of c.slopes) {
      out.push(
        '| ' +
          s.name +
          ' | ' +
          (s.youKgPerMonth >= 0 ? '+' : '') +
          s.youKgPerMonth.toFixed(1) +
          ' | ' +
          (s.themKgPerMonth >= 0 ? '+' : '') +
          s.themKgPerMonth.toFixed(1) +
          ' | ' +
          (s.significant ? 'real difference' : 'within noise') +
          ' |',
      );
    }
    out.push('');
  }

  out.push('## How you each train');
  out.push('');
  out.push('All rates rather than totals, so a longer history does not simply win.');
  out.push('');
  out.push('| | You | ' + them + ' |');
  out.push('| --- | ---: | ---: |');
  out.push(
    '| Sessions / week | ' +
      c.you.sessionsPerWeek.toFixed(2) +
      ' | ' +
      c.them.sessionsPerWeek.toFixed(2) +
      ' |',
  );
  out.push(
    '| Sets / session | ' +
      c.you.setsPerSession.toFixed(1) +
      ' | ' +
      c.them.setsPerSession.toFixed(1) +
      ' |',
  );
  out.push(
    '| Volume / week (' +
      unit +
      ') | ' +
      w(c.you.volumePerWeekKg, unit) +
      ' | ' +
      w(c.them.volumePerWeekKg, unit) +
      ' |',
  );
  out.push('| Sessions logged | ' + c.you.sessions + ' | ' + c.them.sessions + ' |');
  out.push(
    '| Covering | ' +
      isoDay(c.you.from) +
      ' to ' +
      isoDay(c.you.to) +
      ' | ' +
      isoDay(c.them.from) +
      ' to ' +
      isoDay(c.them.to) +
      ' |',
  );
  out.push('');

  if (c.theyDoYouDont.length > 0) {
    out.push('## What ' + them + ' trains and you do not');
    out.push('');
    out.push(c.theyDoYouDont.map((x) => x.name + ' (' + x.sessions + ')').join(', '));
    out.push('');
  }

  out.push('---');
  out.push('');
  out.push('Generated by StrongInsight. Everything above was computed in the browser.');
  out.push('');

  return out.join('\n');
}

/**
 * RFC 4180 quoting. Exercise names carry commas and parentheses -- "Bench Press
 * (Barbell)" is the normal case, not the edge one -- and a name with a quote in
 * it must not break the row.
 */
function q(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

export function sharedLiftsToCsv(c: Comparison, opts: ReportOptions): string {
  const { unit } = opts;
  const them = c.them.label;
  const rows: string[] = [];

  rows.push(
    [
      'Exercise',
      'Equipment',
      'You (' + unit + ')',
      them + ' (' + unit + ')',
      'Ratio',
      'Ratio per kg bodyweight',
      'Your best (' + unit + ')',
      'Their best (' + unit + ')',
      'Your sessions',
      'Their sessions',
    ]
      .map(q)
      .join(','),
  );

  for (const l of c.lifts) {
    rows.push(
      [
        q(l.name),
        q(l.equipment),
        w(l.youKg, unit),
        w(l.themKg, unit),
        l.ratio.toFixed(3),
        l.relativeRatio === null ? '' : l.relativeRatio.toFixed(3),
        w(l.youPeakKg, unit),
        w(l.themPeakKg, unit),
        String(l.youSessions),
        String(l.themSessions),
      ].join(','),
    );
  }

  // Excel and Numbers both read a bare LF fine; CRLF is what the spec asks for
  // and what Strong's own exports use, so match the file this app already eats.
  return rows.join('\r\n') + '\r\n';
}
