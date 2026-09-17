import type { EnrichedSet } from '../model/effectiveLoad';
import type { ExerciseMeta } from '../model/types';
import { summariseAll } from './index';
import { balanceSeries, balanceVerdict, volumeMatrix, type MetaLookup } from './balance';
import { bucketBy, daysBetween, type WeekStart } from './buckets';
import { sessionBests } from './series';
import { records, recordsPerBucket } from './records';
import { median, proportionZ, quantile, slopeWithError, sortedFinite, zCritical } from './stats';

/**
 * The weakness engine.
 *
 * PURE, like the rest of derive/: no React, no IO, and -- deliberately -- no
 * "now". Recency is measured against the LAST SESSION IN THE CORPUS, never the
 * wall clock. That is both the only way to keep this module's contract and the
 * more correct answer: against a CSV exported three months ago, wall-clock
 * recency would report every lift in the file as abandoned.
 *
 * The whole design problem here is that a weakness engine finds weaknesses
 * whether or not any exist. Search seven weekdays for the one you train least
 * and you will always find one; search 34 exercises for a stall and you will
 * always find several. On the reference corpus, Saturday is a real hole
 * (z = -5.2) but Monday and Wednesday are indistinguishable from noise, and a
 * naive version of this file would report all three with equal confidence.
 *
 * So every inferential rule reports a z and the size of the family it was tested
 * against, and `gate()` below is the only thing allowed to decide what the user
 * sees. Findings that fail it are counted, not shown -- see `suppressed`, which
 * the view is expected to display. Refusing out loud is the feature.
 */

export type Confidence = 'clear' | 'suggestive';

export type FindingFamily = 'consistency' | 'progression' | 'neglect';

export type FindingKind =
  | 'weekday-rate'
  | 'weekly-trend'
  | 'layoff-pattern'
  | 'stalled-lift'
  | 'regressed-lift'
  | 'progressing-lift'
  | 'pr-rate'
  | 'pr-rate-rising'
  | 'weekly-trend-rising'
  | 'abandoned-lift'
  | 'neglected-muscle'
  | 'imbalance';

export type Evidence = {
  /** The measured quantity, in the finding's own units. */
  observed: number;
  /** What it was measured against, where a comparison exists. */
  expected: number | null;
  /** Sample size behind the claim. */
  n: number;
  /** Standard errors from expected. Null on findings that are facts, not inferences. */
  z: number | null;
  /** How many tests ran alongside this one -- what the correction is applied over. */
  familySize: number;
};

/**
 * Exactly the numbers a finding's card needs to draw itself.
 *
 * Carried on the finding rather than recomputed in the view, so the chart cannot
 * drift from the claim it illustrates -- and it stays plain numbers, so derive/
 * keeps knowing nothing about rendering.
 */
export type FindingChart =
  | {
      type: 'weekday';
      rates: Array<{ weekday: number; trained: number; available: number }>;
      overall: number;
      flagged: number;
    }
  | { type: 'series'; values: number[]; trend: [number, number] | null };

export type Finding = {
  /** Stable across runs, so the view can key on it. */
  id: string;
  kind: FindingKind;
  family: FindingFamily;
  confidence: Confidence;
  /**
   * Ranking key within a confidence tier, on a shared 0-6 urgency scale.
   *
   * This is a PRESENTATION heuristic, not a statistic. Tested findings use |z|,
   * which lands naturally in 2-6; findings that are facts are mapped onto the
   * same range by their own magnitude so the two can be interleaved. Without a
   * common scale, "you stopped doing Chin Up" (24 sessions) outranks a z = -5.2
   * adherence hole purely because 24 is a bigger number than 5.
   */
  weight: number;
  title: string;
  detail: string;
  /** Exercise or muscle name, where the finding is about one. */
  subject?: string;
  evidence: Evidence;
  chart?: FindingChart;
};

export type FindingSet = {
  /** Ranked: clear before suggestive, then by weight. */
  findings: Finding[];
  /**
   * What is going WELL, held to the same gate. A lift climbing at 3 sigma is as
   * real as one falling at 3 sigma, and a page that can only ever accuse reads
   * as a list of accusations. Every entry here is also counted in `notAdverse`.
   */
  positives: Finding[];
  /** Tests that ran and did not clear the noise floor. The honest denominator. */
  suppressed: number;
  /**
   * Tests that ran and found nothing wrong -- a weekday you train MORE than
   * average, a lift that is progressing. Distinct from `suppressed`: that is
   * "too weak to call", this is "called, and fine".
   */
  notAdverse: number;
  testsRun: number;
  /** Rules that could not run at all for want of data, e.g. "stalled-lift". */
  skippedRules: string[];
};

export type InsightOptions = { weekStartsOn: WeekStart };

// --- thresholds, all in one place ---------------------------------------------

/** Uncorrected two-tailed significance. Anything below this is never shown. */
const ALPHA = 0.05;
/** A lift needs this many sessions with a usable e1RM before a trend means anything. */
export const MIN_TREND_POINTS = 10;
/** ...spanning at least this long. Ten sessions in one fortnight is not a trend. */
export const MIN_TREND_DAYS = 56;
/**
 * A lift has plateaued when its fitted gain over the observed span is
 * significantly SMALLER than this fraction of its estimated 1RM. 2.5% of a
 * 100 kg lift is 2.5 kg -- one small plate a side over two months or more is
 * the least anyone would call progress. Equivalence-style: "flat" is a claim
 * and gets tested, not assumed from a slope that merely failed to be negative.
 */
export const MIN_GAIN_FRACTION = 0.025;
/** Sessions of history before a dropped lift counts as abandoned rather than tried. */
export const MIN_ABANDON_SESSIONS = 8;
/** Days without a lift, measured from the last session in the corpus. */
export const ABANDON_DAYS = 90;
/** A gap longer than this is a layoff rather than a rest day. */
export const LAYOFF_DAYS = 7;
/**
 * The PR-rate trend is measured over at most this many months, ending at the
 * last session. Over a whole history the rate ALWAYS falls -- a first year is
 * nothing but records -- and reporting that would tell every intermediate
 * lifter they are drying up. Over the last year it says something about now.
 */
export const PR_RATE_MONTHS = 12;
export const PR_RATE_MIN_MONTHS = 6;
/**
 * Flag this many weekdays or more and it is a training schedule, not a set of
 * holes in one -- they fold into a single observation.
 */
export const REST_DAY_FOLD = 3;

const WEEKDAY_NAMES = [
  'Sundays',
  'Mondays',
  'Tuesdays',
  'Wednesdays',
  'Thursdays',
  'Fridays',
  'Saturdays',
];

// --- the gate -----------------------------------------------------------------

/**
 * The only place a finding becomes visible.
 *
 * `clear` demands survival of a Bonferroni correction across the family: with
 * seven weekdays the bar is |z| >= 2.69 rather than 1.96, and with 34 exercises
 * it is 3.18. `suggestive` is the uncorrected bar, shown separately and labelled.
 * Below that, nothing -- the finding is counted in `suppressed` and discarded.
 */
function gate(z: number, familySize: number): Confidence | null {
  const abs = Math.abs(z);
  if (abs >= zCritical(ALPHA / Math.max(1, familySize))) return 'clear';
  if (abs >= zCritical(ALPHA)) return 'suggestive';
  return null;
}

/** Accumulates findings so every rule reports through the same gate. */
class Collector {
  readonly findings: Finding[] = [];
  suppressed = 0;
  notAdverse = 0;
  testsRun = 0;
  readonly skippedRules: string[] = [];

  /** A tested claim. Shown only if it survives the gate. */
  test(f: Omit<Finding, 'confidence'> & { evidence: Evidence & { z: number } }): void {
    this.testsRun++;
    const confidence = gate(f.evidence.z, f.evidence.familySize);
    if (confidence === null) {
      this.suppressed++;
      return;
    }
    this.findings.push({ ...f, confidence });
  }

  /**
   * A fact, not an inference: the lift really has not been trained since March.
   * There is nothing to test, so the gate does not apply -- but it is recorded
   * as such rather than being given a fake z, or the gate quietly becomes
   * decorative.
   */
  fact(f: Omit<Finding, 'confidence'>): void {
    this.findings.push({ ...f, confidence: 'clear' });
  }

  readonly positives: Finding[] = [];

  /**
   * A test that ran and found no weakness in the direction that would be one.
   *
   * Given a finding, the good direction is reported through the SAME gate: a
   * positive that would not survive as a weakness does not survive as praise
   * either, so "going well" cannot become the soft-focus version of the tab.
   * Below the gate it is silently a pass -- the counters keep their meaning.
   */
  pass(f?: Omit<Finding, 'confidence'> & { evidence: Evidence & { z: number } }): void {
    this.testsRun++;
    this.notAdverse++;
    if (!f) return;
    const confidence = gate(f.evidence.z, f.evidence.familySize);
    if (confidence === null) return;
    this.positives.push({ ...f, confidence });
  }

  skip(rule: string): void {
    this.skippedRules.push(rule);
  }
}

// --- helpers ------------------------------------------------------------------

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Distinct calendar days on which anything was trained, ascending. */
function sessionDays(sets: EnrichedSet[]): Date[] {
  const keys = new Map<number, Date>();
  for (const s of sets) {
    const d = startOfDay(s.date);
    keys.set(d.getTime(), d);
  }
  return [...keys.values()].sort((a, b) => a.getTime() - b.getTime());
}

function pct(x: number): string {
  return (x * 100).toFixed(0) + '%';
}

/**
 * Map a fact's magnitude onto the same 0-6 band tested findings occupy via |z|.
 * See `Finding.weight`: this is ordering, not evidence.
 */
function urgency(raw: number, typical: number): number {
  return Math.max(0, Math.min(6, (raw / typical) * 3));
}

// --- consistency & adherence --------------------------------------------------

/**
 * Which weekdays carry disproportionately little training.
 *
 * The denominator is what makes this honest. `habitMap.weekdayTotals` counts
 * sessions per weekday but has no notion of opportunity, and four sessions on a
 * Monday means nothing without knowing how many Mondays went by. So each weekday
 * is scored as (days trained / calendar occurrences of that weekday in the span)
 * against the overall daily training rate.
 *
 * Note this measures training RATE, not skipping. Someone running Tue/Thu/Sun by
 * design has not skipped Saturday, that is their programme -- the engine cannot
 * tell intent from slippage and the copy must not pretend otherwise.
 */
function weekdayRates(days: Date[], c: Collector): void {
  if (days.length < 20) {
    c.skip('weekday-rate');
    return;
  }
  const first = days[0] as Date;
  const last = days[days.length - 1] as Date;

  const trained = new Array<number>(7).fill(0);
  for (const d of days) trained[d.getDay()] = (trained[d.getDay()] as number) + 1;

  // Calendar occurrences of each weekday across the span, inclusive.
  const available = new Array<number>(7).fill(0);
  const span = daysBetween(first, last) + 1;
  for (let i = 0; i < span; i++) {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i);
    available[d.getDay()] = (available[d.getDay()] as number) + 1;
  }

  const overall = days.length / span;
  const rates = Array.from({ length: 7 }, (_, wd) => ({
    weekday: wd,
    trained: trained[wd] as number,
    available: available[wd] as number,
  }));

  // Collect first, report second. Which findings are worth making depends on how
  // MANY of them there are -- see the fold below.
  type Flag = { wd: number; k: number; n: number; rate: number; z: number };
  const flagged: Flag[] = [];

  for (let wd = 0; wd < 7; wd++) {
    const n = available[wd] as number;
    const k = trained[wd] as number;
    if (n === 0) continue;
    const z = proportionZ(k, n, overall);
    if (z === null) {
      c.skip('weekday-rate');
      return;
    }
    // Only under-training is a weakness. A weekday you train MORE than average
    // is the programme working, not a problem to fix.
    if (z >= 0) {
      c.pass();
      continue;
    }
    c.testsRun++;
    if (gate(z, 7) === null) {
      c.suppressed++;
      continue;
    }
    flagged.push({ wd, k, n, rate: k / n, z });
  }

  if (flagged.length === 0) return;

  /**
   * Four separate "you rarely train X" cards is what a three-day split looks
   * like from the inside, and it reads as four accusations rather than one
   * observation. Past half the week, the finding is not a hole in the schedule
   * -- it IS the schedule, and it gets a single card that says so.
   */
  if (flagged.length >= REST_DAY_FOLD) {
    const names = flagged.map((f) => WEEKDAY_NAMES[f.wd] as string);
    const trainedDays = [0, 1, 2, 3, 4, 5, 6]
      .filter((wd) => !flagged.some((f) => f.wd === wd))
      .map((wd) => WEEKDAY_NAMES[wd] as string);
    const worst = flagged.reduce((a, b) => (a.z <= b.z ? a : b));
    c.findings.push({
      id: 'weekday:concentrated',
      kind: 'weekday-rate',
      family: 'consistency',
      confidence: 'clear',
      weight: Math.abs(worst.z),
      title: 'Your training sits on ' + listOf(trainedDays),
      detail:
        listOf(names) + ' carry almost nothing. Across ' + flagged.length +
        ' of the seven weekdays that is a schedule rather than a gap, so this is one ' +
        'observation about your week, not a fault in it.',
      evidence: {
        observed: worst.rate,
        expected: overall,
        n: worst.n,
        z: worst.z,
        familySize: 7,
      },
      chart: { type: 'weekday', rates, overall, flagged: worst.wd },
    });
    return;
  }

  for (const f of flagged) {
    c.findings.push({
      id: 'weekday:' + f.wd,
      kind: 'weekday-rate',
      family: 'consistency',
      confidence: gate(f.z, 7) as Confidence,
      weight: Math.abs(f.z),
      title: 'You rarely train ' + WEEKDAY_NAMES[f.wd],
      detail:
        'Trained ' + f.k + ' of ' + f.n + ' ' + WEEKDAY_NAMES[f.wd] + ' (' + pct(f.rate) +
        ') against ' + pct(overall) + ' across all days. Whether that is your programme or ' +
        'slippage is yours to say -- the data only shows the gap.',
      evidence: { observed: f.rate, expected: overall, n: f.n, z: f.z, familySize: 7 },
      chart: { type: 'weekday', rates, overall, flagged: f.wd },
    });
  }
}

/** "Mondays, Wednesdays and Fridays" */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
}

/**
 * Are sessions per week trending down?
 *
 * `bucketBy` returns contiguous weeks INCLUDING empty ones, which is the whole
 * point: a week with no training is an observation, not a gap in the data.
 */
function weeklyTrend(sets: EnrichedSet[], weekStartsOn: WeekStart, c: Collector): void {
  const weeks = bucketBy(sets, (s) => s.date, 'week', weekStartsOn);
  if (weeks.length < 8) {
    c.skip('weekly-trend');
    return;
  }
  const counts = weeks.map((w) => new Set(w.items.map((s) => s.workoutId)).size);
  const fit = slopeWithError(counts.map((y, x) => ({ x, y })));
  if (fit === null) {
    c.skip('weekly-trend');
    return;
  }
  const meanPerWeek = counts.reduce((a, b) => a + b, 0) / counts.length;
  const perTenWeeks = Math.abs(fit.slope) * 10;
  // Only a decline is a weakness; a rise is worth saying, through the same gate.
  if (fit.slope >= 0) {
    c.pass(
      fit.slope > 0
        ? {
            id: 'weekly-trend-rising',
            kind: 'weekly-trend-rising',
            family: 'consistency',
            weight: fit.z,
            title: 'You are training more often',
            detail:
              'Sessions per week are rising by about ' + perTenWeeks.toFixed(2) +
              ' every ten weeks across ' + weeks.length + ' weeks, from an average of ' +
              meanPerWeek.toFixed(1) + '.',
            evidence: { observed: fit.slope, expected: 0, n: weeks.length, z: fit.z, familySize: 1 },
            chart: {
              type: 'series',
              values: counts,
              trend: [fit.intercept, fit.intercept + fit.slope * (counts.length - 1)],
            },
          }
        : undefined,
    );
    return;
  }
  c.test({
    id: 'weekly-trend',
    kind: 'weekly-trend',
    family: 'consistency',
    weight: Math.abs(fit.z),
    title: 'Your training frequency is falling',
    detail:
      'Sessions per week are dropping by about ' + perTenWeeks.toFixed(2) +
      ' every ten weeks across ' + weeks.length + ' weeks, from an average of ' +
      meanPerWeek.toFixed(1) + '.',
    evidence: {
      observed: fit.slope,
      expected: 0,
      n: weeks.length,
      z: fit.z,
      familySize: 1,
    },
    chart: {
      type: 'series',
      values: counts,
      trend: [fit.intercept, fit.intercept + fit.slope * (counts.length - 1)],
    },
  });
}

/**
 * How training breaks up. Descriptive: with a dozen layoffs there is no power to
 * infer what causes them, and the card says so rather than implying a reason.
 */
function layoffs(days: Date[], c: Collector): void {
  if (days.length < 10) {
    c.skip('layoff-pattern');
    return;
  }
  const gaps: number[] = [];
  for (let i = 1; i < days.length; i++) {
    gaps.push(daysBetween(days[i - 1] as Date, days[i] as Date));
  }
  const long = gaps.filter((g) => g > LAYOFF_DAYS);
  if (long.length === 0) return;

  const med = median(gaps) ?? 0;
  const p90 = quantile(sortedFinite(gaps), 0.9) ?? 0;
  const longest = Math.max(...gaps);

  c.fact({
    id: 'layoff-pattern',
    kind: 'layoff-pattern',
    family: 'consistency',
    weight: urgency(long.length / days.length, 0.05),
    title:
      long.length === 1
        ? 'One layoff of more than a week'
        : long.length + ' layoffs of more than a week',
    detail:
      'Your median gap between sessions is ' + med + ' days and nine in ten are within ' +
      p90 + ', but ' + long.length + ' gaps ran past ' + LAYOFF_DAYS +
      ' days, the longest ' + longest + '. Too few to say what causes them.',
    evidence: {
      observed: long.length,
      expected: null,
      n: gaps.length,
      z: null,
      familySize: 1,
    },
  });
}

// --- progression & stagnation -------------------------------------------------

/**
 * Lifts whose estimated 1RM is not going anywhere.
 *
 * Two traps this has to dodge. `setOrder === 1` does NOT mean the first working
 * set (see types.ts), so this reads sessionBests, which already works off the
 * whole session. And `e1rm` refuses past 12 reps, so a high-rep accessory yields
 * a sparse series -- the minimum is counted in USABLE points, not in sessions.
 */
function stalledLifts(sets: EnrichedSet[], abandoned: Set<string>, c: Collector): void {
  const byName = new Map<string, EnrichedSet[]>();
  for (const s of sets) {
    // A lift you stopped doing is already reported as abandoned. Also calling it
    // "going backwards" describes the decline on the way out the door and reads
    // as two separate problems, so it is excluded here -- including from the
    // family size, since no test is being run on it.
    if (abandoned.has(s.canonicalName)) continue;
    const list = byName.get(s.canonicalName);
    if (list) list.push(s);
    else byName.set(s.canonicalName, [s]);
  }

  type Candidate = {
    name: string;
    fit: NonNullable<ReturnType<typeof slopeWithError>>;
    points: number;
    days: number;
    firstKg: number;
    lastKg: number;
    series: number[];
    spanDays: number;
  };
  const candidates: Candidate[] = [];

  for (const [name, list] of byName) {
    const bests = sessionBests(list)
      .filter((b) => b.bestE1rmKg !== null)
      .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (bests.length < MIN_TREND_POINTS) continue;

    const firstDate = bests[0]?.date as Date;
    const lastDate = bests[bests.length - 1]?.date as Date;
    const span = daysBetween(firstDate, lastDate);
    if (span < MIN_TREND_DAYS) continue;

    // x in days, so the slope reads as kg/day rather than kg/millisecond.
    const fit = slopeWithError(
      bests.map((b) => ({ x: daysBetween(firstDate, b.date), y: b.bestE1rmKg as number })),
    );
    if (fit === null) continue;

    candidates.push({
      name,
      fit,
      points: bests.length,
      days: span,
      firstKg: bests[0]?.bestE1rmKg as number,
      lastKg: bests[bests.length - 1]?.bestE1rmKg as number,
      series: bests.map((b) => b.bestE1rmKg as number),
      spanDays: span,
    });
  }

  if (candidates.length === 0) {
    c.skip('stalled-lift');
    return;
  }

  // The family is every lift that was eligible, not just the ones that looked
  // bad. Testing 34 lifts and reporting the worst at p<.05 finds a stall in pure
  // noise about four times in five.
  const familySize = candidates.length;

  for (const cand of candidates) {
    const perMonth = cand.fit.slope * 30;
    const chart: FindingChart = {
      type: 'series',
      values: cand.series,
      trend: [cand.fit.intercept, cand.fit.intercept + cand.fit.slope * cand.spanDays],
    };
    const evidence = (z: number): Evidence & { z: number } => ({
      observed: cand.fit.slope,
      expected: 0,
      n: cand.points,
      z,
      familySize,
    });

    // Falling, and provably so. A slope that is merely negative is not: it
    // gets the plateau test below, since "flat" is where most such lifts sit.
    if (cand.fit.slope < 0 && gate(cand.fit.z, familySize) !== null) {
      c.test({
        id: 'regressed:' + cand.name,
        kind: 'regressed-lift',
        family: 'progression',
        subject: cand.name,
        weight: Math.abs(cand.fit.z),
        title: cand.name + ' is going backwards',
        detail:
          'Estimated 1RM is falling about ' + Math.abs(perMonth).toFixed(1) +
          ' kg a month across ' + cand.points + ' sessions over ' + cand.days +
          ' days (' + cand.firstKg.toFixed(1) + ' kg to ' + cand.lastKg.toFixed(1) + ' kg).',
        evidence: evidence(cand.fit.z),
        chart,
      });
      continue;
    }

    /**
     * The plateau test. Not "slope is about zero" -- that is what a slope looks
     * like before there is evidence either way. The claim is that the gain over
     * the span is significantly less than a meaningful one, and it is scored as
     * how many standard errors the fitted slope sits BELOW that minimum. A
     * perfectly collinear series has stdErr 0 and is left to the fact below.
     */
    const meanKg = cand.series.reduce((a, b) => a + b, 0) / cand.series.length;
    const minGainPerDay = (MIN_GAIN_FRACTION * meanKg) / cand.spanDays;
    if (cand.fit.stdErr === 0) {
      if (cand.fit.slope === 0) {
        // Identical every session: nothing to infer, and nothing moved.
        c.fact({
          id: 'stalled:' + cand.name,
          kind: 'stalled-lift',
          family: 'progression',
          subject: cand.name,
          weight: 3,
          title: cand.name + ' has not moved',
          detail:
            'The same estimated 1RM in every one of ' + cand.points + ' sessions over ' +
            cand.days + ' days.',
          evidence: { observed: 0, expected: minGainPerDay, n: cand.points, z: null, familySize: 1 },
          chart,
        });
      } else {
        c.pass();
      }
      continue;
    }

    const zFlat = (minGainPerDay - cand.fit.slope) / cand.fit.stdErr;
    if (zFlat > 0 && gate(zFlat, familySize) !== null) {
      const gained = cand.fit.slope * cand.spanDays;
      c.test({
        id: 'stalled:' + cand.name,
        kind: 'stalled-lift',
        family: 'progression',
        subject: cand.name,
        weight: zFlat,
        title: cand.name + ' has plateaued',
        detail:
          'Estimated 1RM moved about ' + gained.toFixed(1) + ' kg over ' + cand.days +
          ' days across ' + cand.points + ' sessions, against at least ' +
          (MIN_GAIN_FRACTION * meanKg).toFixed(1) + ' kg for that to count as progress. ' +
          'Flat within the noise, not merely not falling.',
        evidence: { ...evidence(zFlat), expected: minGainPerDay },
        chart,
      });
      continue;
    }

    // Neither provably falling nor provably flat. A negative slope was tested
    // as a regression and did not clear; a non-negative one is a pass, and if
    // it is provably RISING, say so.
    if (cand.fit.slope < 0) {
      c.testsRun++;
      c.suppressed++;
      continue;
    }
    c.pass(
      cand.fit.slope > 0
        ? {
            id: 'progressing:' + cand.name,
            kind: 'progressing-lift',
            family: 'progression',
            subject: cand.name,
            weight: cand.fit.z,
            title: cand.name + ' is climbing',
            detail:
              'Estimated 1RM is rising about ' + perMonth.toFixed(1) + ' kg a month across ' +
              cand.points + ' sessions over ' + cand.days + ' days (' + cand.firstKg.toFixed(1) +
              ' kg to ' + cand.lastKg.toFixed(1) + ' kg).',
            evidence: evidence(cand.fit.z),
            chart,
          }
        : undefined,
    );
  }
}

/**
 * Are personal records getting rarer?
 *
 * Counts every record kind together: a lift can set a rep PR for months
 * without a load PR, and that is still progress. Only a decline is a weakness.
 */
function prRate(sets: EnrichedSet[], weekStartsOn: WeekStart, c: Collector): void {
  let first: Date | null = null;
  let last: Date | null = null;
  for (const s of sets) {
    if (first === null || s.date < first) first = s.date;
    if (last === null || s.date > last) last = s.date;
  }
  if (first === null || last === null) {
    c.skip('pr-rate');
    return;
  }
  // Spanned to the corpus, not to the last record: the dry months since the
  // last PR are the observation, and they only exist as empty buckets.
  const months = recordsPerBucket(records(sets), {
    granularity: 'month',
    weekStartsOn,
    span: { from: first, to: last },
  });
  const window = months.slice(-PR_RATE_MONTHS);
  if (window.length < PR_RATE_MIN_MONTHS) {
    c.skip('pr-rate');
    return;
  }

  const counts = window.map((m) => m.count);
  const fit = slopeWithError(counts.map((y, x) => ({ x, y })));
  if (fit === null || fit.stdErr === 0) {
    c.skip('pr-rate');
    return;
  }
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const startFit = Math.max(0, fit.intercept);
  const endFit = Math.max(0, fit.intercept + fit.slope * (counts.length - 1));
  if (fit.slope >= 0) {
    c.pass(
      fit.slope > 0
        ? {
            id: 'pr-rate-rising',
            kind: 'pr-rate-rising',
            family: 'progression',
            weight: fit.z,
            title: 'Personal records are coming faster',
            detail:
              'Across the last ' + window.length + ' months the trend runs from about ' +
              startFit.toFixed(1) + ' records a month to ' + endFit.toFixed(1) +
              ', around an average of ' + mean.toFixed(1) + '.',
            evidence: { observed: fit.slope, expected: 0, n: window.length, z: fit.z, familySize: 1 },
            chart: {
              type: 'series',
              values: counts,
              trend: [fit.intercept, fit.intercept + fit.slope * (counts.length - 1)],
            },
          }
        : undefined,
    );
    return;
  }
  c.test({
    id: 'pr-rate',
    kind: 'pr-rate',
    family: 'progression',
    weight: Math.abs(fit.z),
    title: 'Personal records are drying up',
    detail:
      'Across the last ' + window.length + ' months the trend runs from about ' +
      startFit.toFixed(1) + ' records a month to ' + endFit.toFixed(1) +
      ', around an average of ' + mean.toFixed(1) + '. Every kind counts: a new best load, ' +
      'a new estimated 1RM, or more reps at a load you had lifted before.',
    evidence: {
      observed: fit.slope,
      expected: 0,
      n: window.length,
      z: fit.z,
      familySize: 1,
    },
    chart: {
      type: 'series',
      values: counts,
      trend: [fit.intercept, fit.intercept + fit.slope * (counts.length - 1)],
    },
  });
}

// --- neglect & imbalance ------------------------------------------------------

/**
 * Lifts trained seriously, then dropped. A fact about the corpus, not a test.
 *
 * Returns the names so `stalledLifts` can leave them alone.
 */
function abandonedLifts(sets: EnrichedSet[], c: Collector): Set<string> {
  const days = sessionDays(sets);
  const last = days[days.length - 1];
  const abandoned = new Set<string>();
  if (!last) return abandoned;

  const sessionsOf = new Map<string, Set<string>>();
  for (const s of sets) {
    const set = sessionsOf.get(s.canonicalName);
    if (set) set.add(s.workoutId);
    else sessionsOf.set(s.canonicalName, new Set([s.workoutId]));
  }

  for (const s of summariseAll(sets)) {
    if (s.lastDate === null) continue;
    const sessions = sessionsOf.get(s.name)?.size ?? 0;
    const gone = daysBetween(s.lastDate, last);
    if (sessions < MIN_ABANDON_SESSIONS || gone <= ABANDON_DAYS) continue;
    abandoned.add(s.name);

    c.fact({
      id: 'abandoned:' + s.name,
      kind: 'abandoned-lift',
      family: 'neglect',
      subject: s.name,
      // Depth of history, discounted by how long ago it stopped. A staple you
      // dropped three months ago is worth raising; something you last touched
      // fourteen months ago is a decision you already made, not a weakness.
      weight: urgency(sessions / Math.sqrt(gone / ABANDON_DAYS), 12),
      title: 'You stopped doing ' + s.name,
      detail:
        sessions + ' sessions of history, then nothing for ' + gone +
        ' days before your last workout.',
      evidence: { observed: gone, expected: null, n: sessions, z: null, familySize: 1 },
    });
  }
  return abandoned;
}

/**
 * Muscles whose share of volume has fallen away from their own historical share.
 *
 * Against the user's own baseline, not anyone's idea of a correct split -- the
 * app has no opinion about how much chest a person should train.
 */
function neglectedMuscles(
  sets: EnrichedSet[],
  meta: MetaLookup,
  weekStartsOn: WeekStart,
  c: Collector,
): void {
  const matrix = volumeMatrix(sets, meta, { granularity: 'month', weekStartsOn, by: 'muscle' });
  const buckets = matrix.buckets.length;
  if (buckets < 6) {
    c.skip('neglected-muscle');
    return;
  }
  // Last quarter against everything before it.
  const cut = buckets - 3;

  type Row = { group: string; recent: number; prior: number; z: number };
  const rows: Row[] = [];

  for (let g = 0; g < matrix.groups.length; g++) {
    const group = matrix.groups[g] as string;
    if (group === 'unknown') continue;
    const cells = matrix.cells[g];
    if (!cells) continue;

    const recentVals = cells.slice(cut).map((x) => x.volumeKg);
    const priorVals = cells.slice(0, cut).map((x) => x.volumeKg);
    const priorMed = median(priorVals);
    if (priorMed === null || priorMed <= 0) continue;

    // Share-of-total, so a general deload does not read as neglect of everything.
    const recentShare = recentVals.reduce((a, b) => a + b, 0);
    const totalRecent = matrix.cells.reduce(
      (a, row) => a + row.slice(cut).reduce((x, y) => x + y.volumeKg, 0),
      0,
    );
    const priorShare = priorVals.reduce((a, b) => a + b, 0);
    const totalPrior = matrix.cells.reduce(
      (a, row) => a + row.slice(0, cut).reduce((x, y) => x + y.volumeKg, 0),
      0,
    );
    if (totalRecent <= 0 || totalPrior <= 0) continue;

    const pNow = recentShare / totalRecent;
    const pBefore = priorShare / totalPrior;
    // Treat sets as the trial count: volume is continuous, but the question is
    // "what fraction of the work went here", and sets are the countable unit.
    const trials = cells.slice(cut).reduce((a, x) => a + x.setCount, 0);
    const successes = Math.round(pNow * trials);
    const z = proportionZ(successes, trials, pBefore);
    if (z === null) continue;

    rows.push({ group, recent: pNow, prior: pBefore, z });
  }

  if (rows.length === 0) {
    c.skip('neglected-muscle');
    return;
  }

  for (const r of rows) {
    if (r.z >= 0) {
      c.pass();
      continue;
    }
    c.test({
      id: 'neglected:' + r.group,
      kind: 'neglected-muscle',
      family: 'neglect',
      subject: r.group,
      weight: Math.abs(r.z),
      title: r.group + ' has dropped off',
      detail:
        'It took ' + pct(r.recent) + ' of your recent volume against ' + pct(r.prior) +
        ' historically.',
      evidence: {
        observed: r.recent,
        expected: r.prior,
        n: rows.length,
        z: r.z,
        familySize: rows.length,
      },
    });
  }
}

/**
 * Push/pull and upper/lower.
 *
 * `balanceVerdict` is already a weakness rule engine with measured thresholds and
 * its own refusal below four periods of data. Wrapping it beats reimplementing
 * those thresholds a second time and letting the two drift apart.
 */
function imbalances(
  sets: EnrichedSet[],
  meta: MetaLookup,
  weekStartsOn: WeekStart,
  c: Collector,
): void {
  const points = balanceSeries(sets, meta, { granularity: 'month', weekStartsOn });
  const verdict = balanceVerdict(points);
  if (verdict.flags.length === 0) {
    if (points.length < 4) c.skip('imbalance');
    return;
  }
  verdict.flags.forEach((flag, i) => {
    c.fact({
      id: 'imbalance:' + i,
      kind: 'imbalance',
      family: 'neglect',
      // A breached threshold has no magnitude to scale, so it sits mid-band.
      weight: 3,
      title: 'Your split is lopsided',
      detail: flag,
      evidence: {
        observed: verdict.medianPullPush ?? 0,
        expected: null,
        n: points.length,
        z: null,
        familySize: 1,
      },
    });
  });
}

// --- orchestrator -------------------------------------------------------------

const TIER_RANK: Record<Confidence, number> = { clear: 0, suggestive: 1 };

export function findings(
  sets: EnrichedSet[],
  meta: (name: string) => ExerciseMeta | undefined,
  opts: InsightOptions,
): FindingSet {
  const c = new Collector();
  if (sets.length === 0) {
    return {
      findings: [],
      positives: [],
      suppressed: 0,
      notAdverse: 0,
      testsRun: 0,
      skippedRules: ['no data'],
    };
  }

  const days = sessionDays(sets);

  weekdayRates(days, c);
  weeklyTrend(sets, opts.weekStartsOn, c);
  layoffs(days, c);
  // Abandoned runs first: a lift you stopped doing must not also be reported as
  // stalled, nor inflate the stall family size.
  const abandoned = abandonedLifts(sets, c);
  stalledLifts(sets, abandoned, c);
  prRate(sets, opts.weekStartsOn, c);
  neglectedMuscles(sets, meta, opts.weekStartsOn, c);
  imbalances(sets, meta, opts.weekStartsOn, c);

  const rank = (a: Finding, b: Finding) => {
    const tier = TIER_RANK[a.confidence] - TIER_RANK[b.confidence];
    if (tier !== 0) return tier;
    if (b.weight !== a.weight) return b.weight - a.weight;
    // Stable, so re-running never reshuffles equal findings.
    return a.id.localeCompare(b.id);
  };

  return {
    findings: c.findings.slice().sort(rank),
    positives: c.positives.slice().sort(rank),
    suppressed: c.suppressed,
    notAdverse: c.notAdverse,
    testsRun: c.testsRun,
    skippedRules: c.skippedRules,
  };
}
