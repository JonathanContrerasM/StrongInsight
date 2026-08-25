import Papa from 'papaparse';
import type { BodyweightEntry, WeightUnit } from '../model/types';
import { mapBodyweightHeaders, type BodyweightColumn } from './headerMap';
import { normalizeToken } from './classifyRow';
import { LB_TO_KG, parseStrongDate, toNumber } from './parseCsv';
import { sniffDelimiter } from './sniffDelimiter';

/**
 * Strong's body-measurements export -> bodyweight history.
 *
 * The file is a long/tall table spanning the user's whole life with Apple Health,
 * not just their training. Three things follow from that and drive everything
 * below:
 *
 *   1. It carries measurement kinds we do not model (body fat, circumferences),
 *      so rows are filtered by kind, not assumed.
 *   2. Health apps write junk -- the reference export has three 0 kg rows logged
 *      within nine minutes of each other -- so values are range-checked.
 *   3. It predates the training history by years. Weight from before the first
 *      workout cannot inform any set, and anchoring the ramp on a reading from
 *      eight years ago actively misleads, so rows are clipped to the workout span.
 *
 * Like `parseCsv`, this must never import from `src/meta` or `src/store`: the
 * workout span arrives as an argument, not as a store read.
 *
 * This does NOT interpolate. `makeBodyweightResolver` already interpolates
 * linearly between entries at read time, so storing densified daily rows would
 * bury the real observations and freeze today's interpolation into the database.
 */

/** Measurement kinds that mean "bodyweight", normalised by `normalizeToken`. */
const WEIGHT_TOKENS = new Set([
  'gewicht',
  'korpergewicht',
  'weight',
  'bodyweight',
  'peso',
  'pesocorporal',
  'poids',
  'massa',
  'vikt',
]);

/** Unit cell -> multiplier to kilograms. */
const UNIT_TO_KG: Record<string, number> = {
  kg: 1,
  kgs: 1,
  kilogram: 1,
  kilograms: 1,
  lb: LB_TO_KG,
  lbs: LB_TO_KG,
  pound: LB_TO_KG,
  pounds: LB_TO_KG,
};

/**
 * Anything outside this is not a human bodyweight, it is a broken reading.
 * Wide on purpose: the band exists to catch zeros and unit disasters, not to
 * second-guess the user's body.
 */
export const MIN_PLAUSIBLE_KG = 30;
export const MAX_PLAUSIBLE_KG = 300;

/** Fraction either side of the median beyond which a surviving row is an outlier. */
export const OUTLIER_TOLERANCE = 0.25;

/** Fewest readings the outlier pass will judge. Below this it does nothing. */
export const MIN_OUTLIER_SAMPLE = 3;

export type RejectedRow = {
  line: number;
  /** Verbatim, so the user can find it in their file. */
  raw: string;
  reason: 'not-a-number' | 'implausible' | 'outlier' | 'unknown-unit' | 'bad-date';
};

export type BodyweightImportReport = {
  filename: string;
  delimiter: string;
  delimiterConfident: boolean;
  headersRecognised: string[];
  headersUnrecognised: string[];

  rowsRead: number;
  entriesKept: number;

  /** Measurement kinds present in the file that are not bodyweight, with counts. */
  skippedTypes: Array<{ type: string; count: number }>;
  /** True when the file had one unrecognised kind in a mass unit and we took it anyway. */
  assumedSingleType: boolean;
  /** True when no measurement-type column existed at all. */
  noTypeColumn: boolean;

  /** Rows refused, each with its file line and verbatim value. */
  rejected: RejectedRow[];
  /** Readings that fell outside the workout span. */
  outOfSpan: number;
  /** Extra readings discarded because their day already had a later one. */
  sameDayCollapsed: number;

  /** The workout span the rows were clipped to, if one was supplied. */
  span: { from: Date; to: Date } | null;
  /** Span of what actually survived. */
  dateRange: { from: string; to: string } | null;
};

export type BodyweightParseOptions = {
  filename?: string;
  /** Fallback when the file carries no unit column and no unit header suffix. */
  unit?: WeightUnit;
  /** The workout date span. Rows outside it are dropped. */
  span?: { from: Date; to: Date } | null;
};

export type BodyweightParseResult = {
  entries: BodyweightEntry[];
  report: BodyweightImportReport;
};

function emptyReport(filename: string): BodyweightImportReport {
  return {
    filename,
    delimiter: ',',
    delimiterConfident: false,
    headersRecognised: [],
    headersUnrecognised: [],
    rowsRead: 0,
    entriesKept: 0,
    skippedTypes: [],
    assumedSingleType: false,
    noTypeColumn: false,
    rejected: [],
    outOfSpan: 0,
    sameDayCollapsed: 0,
    span: null,
    dateRange: null,
  };
}

/** Local-date key, matching the `YYYY-MM-DD` form `BodyweightEntry` persists. */
function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length === 0) return 0;
  if (s.length % 2 === 1) return s[mid] as number;
  return (((s[mid - 1] as number) + (s[mid] as number)) / 2);
}

type Candidate = {
  line: number;
  at: Date;
  day: string;
  kg: number;
  raw: string;
  /** Verbatim measurement kind, empty when the file has no such column. */
  type: string;
};

export function parseBodyweightCsv(
  text: string,
  opts: BodyweightParseOptions = {},
): BodyweightParseResult {
  const report = emptyReport(opts.filename ?? 'bodyweight.csv');
  report.span = opts.span ?? null;

  if (text.trim() === '') return { entries: [], report };

  const sniff = sniffDelimiter(text);
  report.delimiter = sniff.delimiter;
  report.delimiterConfident = sniff.confident;

  const parsed = Papa.parse<string[]>(text, {
    delimiter: sniff.delimiter,
    skipEmptyLines: 'greedy',
  });
  const rows = parsed.data;
  const headerRow = rows[0];
  if (!headerRow) return { entries: [], report };

  // Throws HeaderMappingError, by design -- same contract as parseCsv.
  const mapping = mapBodyweightHeaders(headerRow);
  report.headersUnrecognised = mapping.unrecognised;
  report.headersRecognised = headerRow.filter((h) => !mapping.unrecognised.includes(h));
  report.noTypeColumn = mapping.index.measurementType === undefined;

  const at = (row: string[], col: BodyweightColumn): string | undefined => {
    const i = mapping.index[col];
    return i === undefined ? undefined : row[i];
  };

  // Header suffix beats the caller's setting, which beats kg -- the same
  // precedence parseCsv uses. A per-row unit cell beats all of it.
  const fallbackUnit: WeightUnit = mapping.weightUnitFromHeader ?? opts.unit ?? 'kg';

  // --- pass 1: which measurement kinds does this file contain? ----------------
  //
  // This has to settle before anything else runs. A body-fat row in "%" is not a
  // broken weight, it is a different measurement, and calling it an unknown unit
  // would be a lie. The escape hatch below also needs the whole file's kinds
  // before it can decide, so a counting pass comes first either way.

  const typeCounts = new Map<string, number>();
  /** Whether a kind's rows are denominated in a mass unit. */
  const typeIsMass = new Map<string, boolean>();
  const dataRows: Array<{ row: string[]; line: number }> = [];

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every((c) => (c ?? '').trim() === '')) continue;
    report.rowsRead++;
    // +1 for the header, +1 because file lines are 1-based.
    dataRows.push({ row, line: r + 1 });

    const rawType = (at(row, 'measurementType') ?? '').trim();
    if (rawType === '') continue;
    typeCounts.set(rawType, (typeCounts.get(rawType) ?? 0) + 1);
    const u = normalizeToken(at(row, 'unit') ?? '');
    // Absent unit column: the caller's setting applies, which is always a mass.
    if (u === '' || UNIT_TO_KG[u] !== undefined) typeIsMass.set(rawType, true);
  }

  const kinds = [...typeCounts.keys()];
  const recognised = new Set(kinds.filter((k) => WEIGHT_TOKENS.has(normalizeToken(k))));
  let accept: (type: string) => boolean;

  if (report.noTypeColumn) {
    // Two-column shape: the header named the kind, every row is a weight.
    accept = () => true;
  } else if (recognised.size > 0) {
    accept = (type) => recognised.has(type);
  } else if (kinds.length === 1 && typeIsMass.get(kinds[0] as string) === true) {
    // One unrecognised kind, denominated in a mass unit: a locale we have no
    // token for. Take it, and say so in the report.
    report.assumedSingleType = true;
    accept = () => true;
  } else {
    accept = () => false;
  }

  for (const [type, count] of typeCounts) {
    if (!accept(type)) report.skippedTypes.push({ type, count });
  }
  report.skippedTypes.sort((a, b) => b.count - a.count);

  // --- pass 2: accepted rows -> candidates, unit-converted and range-checked ---

  const candidates: Candidate[] = [];

  for (const { row, line } of dataRows) {
    const rawType = (at(row, 'measurementType') ?? '').trim();
    if (!accept(rawType)) continue;

    const rawValue = (at(row, 'value') ?? '').trim();
    const date = parseStrongDate(at(row, 'date'));
    if (date === null) {
      report.rejected.push({ line, raw: (at(row, 'date') ?? '').trim(), reason: 'bad-date' });
      continue;
    }

    const n = toNumber(rawValue);
    if (n === null) {
      report.rejected.push({ line, raw: rawValue, reason: 'not-a-number' });
      continue;
    }

    const rawUnit = normalizeToken(at(row, 'unit') ?? '');
    let factor: number;
    if (rawUnit === '') {
      factor = fallbackUnit === 'lb' ? LB_TO_KG : 1;
    } else if (UNIT_TO_KG[rawUnit] !== undefined) {
      factor = UNIT_TO_KG[rawUnit] as number;
    } else {
      report.rejected.push({ line, raw: rawValue + ' ' + rawUnit, reason: 'unknown-unit' });
      continue;
    }

    const kg = n * factor;
    if (!Number.isFinite(kg) || kg < MIN_PLAUSIBLE_KG || kg > MAX_PLAUSIBLE_KG) {
      report.rejected.push({ line, raw: rawValue, reason: 'implausible' });
      continue;
    }

    candidates.push({ line, at: date, day: dayKey(date), kg, raw: rawValue, type: rawType });
  }

  // --- clip to the workout span ------------------------------------------------

  const span = opts.span ?? null;
  let inSpan = candidates;
  if (span) {
    const from = new Date(span.from.getFullYear(), span.from.getMonth(), span.from.getDate());
    // End of the last training day, so a reading later that evening still counts.
    const to = new Date(span.to.getFullYear(), span.to.getMonth(), span.to.getDate(), 23, 59, 59);
    inSpan = candidates.filter((c) => c.at >= from && c.at <= to);
    report.outOfSpan = candidates.length - inSpan.length;
  }

  // --- collapse to one reading per day, last timestamp wins --------------------

  const byDay = new Map<string, Candidate>();
  for (const c of inSpan) {
    const prev = byDay.get(c.day);
    // `>=` so a later line wins a tie, matching the file's own ordering.
    if (!prev || c.at.getTime() >= prev.at.getTime()) byDay.set(c.day, c);
  }
  report.sameDayCollapsed = inSpan.length - byDay.size;

  // --- outlier pass, against the median of what survived -----------------------

  const survivors = [...byDay.values()];
  const final: Candidate[] = [];
  // Below three readings there is no meaningful centre to measure against: with
  // two far-apart values the median lands between them and culls both, which
  // throws away the user's only data on the strength of no evidence at all.
  if (survivors.length < MIN_OUTLIER_SAMPLE) {
    final.push(...survivors);
  } else {
    const med = median(survivors.map((c) => c.kg));
    for (const c of survivors) {
      if (med > 0 && Math.abs(c.kg - med) / med > OUTLIER_TOLERANCE) {
        report.rejected.push({ line: c.line, raw: c.raw, reason: 'outlier' });
        continue;
      }
      final.push(c);
    }
  }

  final.sort((a, b) => a.day.localeCompare(b.day));
  report.rejected.sort((a, b) => a.line - b.line);

  const entries: BodyweightEntry[] = final.map((c) => ({
    date: c.day,
    // Two decimals: lb -> kg conversion otherwise carries meaningless precision.
    kg: Math.round(c.kg * 100) / 100,
  }));

  report.entriesKept = entries.length;
  const first = entries[0];
  const last = entries[entries.length - 1];
  report.dateRange = first && last ? { from: first.date, to: last.date } : null;

  return { entries, report };
}
