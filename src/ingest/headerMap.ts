import type { WeightUnit } from '../model/types';

/**
 * Strong localises its headers. We map by alias table first and fall back to
 * position, so a German or English export parses with no code change.
 */

export type Column =
  | 'date'
  | 'workoutName'
  | 'duration'
  | 'exerciseName'
  | 'setOrder'
  | 'weight'
  | 'reps'
  | 'distance'
  | 'seconds'
  | 'notes'
  | 'workoutNotes'
  | 'rpe';

/** Canonical column order as Strong emits it -- used as the positional fallback. */
export const CANONICAL_ORDER: Column[] = [
  'date',
  'workoutName',
  'duration',
  'exerciseName',
  'setOrder',
  'weight',
  'reps',
  'distance',
  'seconds',
  'notes',
  'workoutNotes',
  'rpe',
];

/** Lowercased, de-accented, punctuation-stripped aliases -> canonical column. */
const ALIASES: Record<string, Column> = {};
function alias(col: Column, ...names: string[]) {
  for (const n of names) ALIASES[normalizeHeader(n)] = col;
}

/** Strip a trailing unit suffix such as "(kg)" / "(lbs)" before matching. */
const UNIT_SUFFIX = /\s*\((kg|kgs|kilograms?|lb|lbs|pounds?)\)\s*$/i;

export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .replace(UNIT_SUFFIX, '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

alias('date', 'Datum', 'Date', 'Fecha', 'Data');
alias('workoutName', 'Workout-Name', 'Workout Name', 'Workout', 'Trainingsname');
alias('duration', 'Dauer', 'Duration', 'Duracion', 'Durata');
alias('exerciseName', 'Name der Übung', 'Exercise Name', 'Exercise', 'Übung', 'Ubung');
alias('setOrder', 'Reihenfolge festlegen', 'Set Order', 'Satz', 'Set');
alias('weight', 'Gewicht', 'Weight', 'Peso', 'Poids');
alias('reps', 'Wiederh.', 'Wiederholungen', 'Reps', 'Repetitions', 'Repeticiones');
alias('distance', 'Entfernung', 'Distance', 'Distanz', 'Distancia');
alias('seconds', 'Sekunden', 'Seconds', 'Segundos', 'Secondes');
alias('notes', 'Notizen', 'Notes', 'Notas');
alias('workoutNotes', 'Workout-Notizen', 'Workout Notes', 'Notas del entrenamiento');
alias('rpe', 'RPE');

export type HeaderMapResult = {
  /** Column -> index into the row array. */
  index: Record<Column, number>;
  /** Unit parsed from a "(kg)"/"(lbs)" suffix on the weight header, if present. */
  weightUnitFromHeader: WeightUnit | null;
  /** Headers we could not place (informational -- positional fallback may cover them). */
  unrecognised: string[];
  /** True when the mapping came from position rather than names. */
  usedPositionalFallback: boolean;
};

export class HeaderMappingError extends Error {
  constructor(
    message: string,
    readonly unrecognised: string[],
    /** Widened to `string[]` so both CSV schemas can throw this. */
    readonly missing: string[],
  ) {
    super(message);
    this.name = 'HeaderMappingError';
  }
}

function unitFromHeader(raw: string): WeightUnit | null {
  const m = UNIT_SUFFIX.exec(raw);
  if (!m) return null;
  return /^(lb|lbs|pound)/i.test(m[1] ?? '') ? 'lb' : 'kg';
}

/** Columns without which we cannot build a meaningful set record. */
const REQUIRED: Column[] = ['date', 'exerciseName', 'setOrder'];

/**
 * The alias-matching core, shared by every CSV schema this app reads.
 *
 * Strong ships more than one export shape -- the workout log and the body
 * measurements log -- and they share nothing but the localisation problem. So
 * the alias table and the required set are parameters, and each schema's own
 * mapper below supplies them along with its own error wording.
 */
function matchHeaders<T extends string>(
  headers: string[],
  aliases: Record<string, T>,
  required: readonly T[],
  unitColumn: T,
): {
  index: Record<T, number>;
  unrecognised: string[];
  missing: T[];
  weightUnitFromHeader: WeightUnit | null;
} {
  const index = {} as Record<T, number>;
  const unrecognised: string[] = [];
  let weightUnitFromHeader: WeightUnit | null = null;

  headers.forEach((h, i) => {
    const col = aliases[normalizeHeader(h)];
    if (col === undefined) {
      if (h.trim().length > 0) unrecognised.push(h);
      return;
    }
    // First occurrence wins if a file somehow repeats a column.
    if (index[col] === undefined) index[col] = i;
    if (col === unitColumn) weightUnitFromHeader = unitFromHeader(h);
  });

  return {
    index,
    unrecognised,
    missing: required.filter((c) => index[c] === undefined),
    weightUnitFromHeader,
  };
}

export function mapHeaders(headers: string[]): HeaderMapResult {
  const matched = matchHeaders(headers, ALIASES, REQUIRED, 'weight');
  const { index, unrecognised, missing, weightUnitFromHeader } = matched;

  // Positional fallback: an unlocalised export whose names we don't know, but
  // whose shape matches Strong's canonical 12-column layout.
  let usedPositionalFallback = false;
  if (missing.length > 0 && headers.length >= CANONICAL_ORDER.length) {
    const recognisedCount = CANONICAL_ORDER.length - missing.length;
    if (recognisedCount === 0) {
      CANONICAL_ORDER.forEach((col, i) => {
        index[col] = i;
      });
      usedPositionalFallback = true;
    }
  }

  const stillMissing = REQUIRED.filter((c) => index[c] === undefined);
  if (stillMissing.length > 0) {
    throw new HeaderMappingError(
      `Unrecognised CSV headers. Could not find a column for: ${stillMissing.join(', ')}. ` +
        `Unrecognised headers were: ${unrecognised.length ? unrecognised.join(', ') : '(none)'}. ` +
        `Expected a Strong export with German (Datum, Workout-Name, ...) or English (Date, Workout Name, ...) headers.`,
      unrecognised,
      stillMissing,
    );
  }

  return { index, weightUnitFromHeader, unrecognised, usedPositionalFallback };
}

// --- the body measurements export ---------------------------------------------

/**
 * Strong's measurements export is a long/tall table: one row per reading, with
 * the KIND of measurement in a cell rather than in the header. So `Gewicht` here
 * is a value to match, not a column name -- see `WEIGHT_TOKENS` in
 * parseBodyweightCsv.
 */
export type BodyweightColumn = 'date' | 'value' | 'measurementType' | 'unit' | 'source';

const BW_ALIASES: Record<string, BodyweightColumn> = {};
function bwAlias(col: BodyweightColumn, ...names: string[]) {
  for (const n of names) BW_ALIASES[normalizeHeader(n)] = col;
}

bwAlias('date', 'Datum', 'Date', 'Fecha', 'Data');
// `Gewicht`/`Weight` are here for the two-column shape some exports use, where
// the measurement kind is the header instead of a cell.
bwAlias('value', 'Value', 'Wert', 'Valor', 'Valeur', 'Gewicht', 'Weight');
bwAlias('measurementType', 'Measurement Type', 'Messungstyp', 'Art der Messung', 'Messung');
bwAlias('unit', 'Unit', 'Einheit', 'Unidad', 'Unite');
bwAlias('source', 'Source', 'Quelle', 'Fuente');

/**
 * Only date and value are required. Without a `measurementType` column every row
 * is assumed to be a weight; without a `unit` column the caller's input-unit
 * setting decides.
 */
const BW_REQUIRED: readonly BodyweightColumn[] = ['date', 'value'];

export type BodyweightHeaderMapResult = {
  index: Record<BodyweightColumn, number>;
  /** Unit parsed from a "(kg)"/"(lbs)" suffix on the value header, if present. */
  weightUnitFromHeader: WeightUnit | null;
  unrecognised: string[];
};

export function mapBodyweightHeaders(headers: string[]): BodyweightHeaderMapResult {
  const { index, unrecognised, missing, weightUnitFromHeader } = matchHeaders(
    headers,
    BW_ALIASES,
    BW_REQUIRED,
    'value',
  );

  if (missing.length > 0) {
    throw new HeaderMappingError(
      `Unrecognised CSV headers. Could not find a column for: ${missing.join(', ')}. ` +
        `Unrecognised headers were: ${unrecognised.length ? unrecognised.join(', ') : '(none)'}. ` +
        `Expected a Strong measurements export with German (Datum, Measurement Type, Value, ...) ` +
        `or English (Date, Measurement Type, Value, ...) headers.`,
      unrecognised,
      missing,
    );
  }

  return { index, weightUnitFromHeader, unrecognised };
}
