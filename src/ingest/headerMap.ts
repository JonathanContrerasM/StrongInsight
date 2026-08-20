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
    readonly missing: Column[],
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

export function mapHeaders(headers: string[]): HeaderMapResult {
  const index = {} as Record<Column, number>;
  const unrecognised: string[] = [];
  let weightUnitFromHeader: WeightUnit | null = null;

  headers.forEach((h, i) => {
    const col = ALIASES[normalizeHeader(h)];
    if (col === undefined) {
      if (h.trim().length > 0) unrecognised.push(h);
      return;
    }
    // First occurrence wins if a file somehow repeats a column.
    if (index[col] === undefined) index[col] = i;
    if (col === 'weight') weightUnitFromHeader = unitFromHeader(h);
  });

  const missing = REQUIRED.filter((c) => index[c] === undefined);

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
