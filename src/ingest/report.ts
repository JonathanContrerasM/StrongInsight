import type { WeightUnit } from '../model/types';

/**
 * Everything the parser noticed. Nothing is ever silently dropped: every row the
 * parser refuses to turn into a set increments a counter here, so a future Strong
 * version cannot corrupt the history without the user being told.
 */
export type UnknownToken = { raw: string; line: number; exerciseName: string };

export type ImportReport = {
  filename: string;
  importedAt: number;

  delimiter: string;
  delimiterConfident: boolean;
  headersRecognised: string[];
  headersUnrecognised: string[];
  usedPositionalFallback: boolean;
  unit: WeightUnit;
  unitSource: 'header' | 'setting';

  rowsRead: number;
  setsParsed: number;
  workingSets: number;
  warmupSets: number;
  dropSets: number;

  /** Every row classified as rest, including malformed ones we could not attach. */
  restRowsSeen: number;
  restRowsCollapsed: number;
  orphanRestRows: number;
  duplicateRestRows: number;
  malformedRestRows: number;

  unknownTokens: UnknownToken[];
  dateParseFailures: number;
  /** Sets logged with load but zero reps -- abandoned sets. Real, but zero volume. */
  zeroRepSets: number;
  /** Non-rest rows carrying a seconds value: isometric holds. */
  isometricSets: number;
  /** Rows with a non-zero distance value (unit ambiguous -- see SetRecord.distanceRaw). */
  distanceRows: number;
  /** Exercise names that had leading/trailing whitespace trimmed for the join key. */
  trimmedNames: string[];
  /** Trimming caused two distinct raw names to collapse into one. */
  nameCollisions: string[];

  workoutCount: number;
  exerciseNames: string[];
  dateRange: { from: Date; to: Date } | null;
};

export function emptyReport(filename: string, importedAt: number): ImportReport {
  return {
    filename,
    importedAt,
    delimiter: ',',
    delimiterConfident: false,
    headersRecognised: [],
    headersUnrecognised: [],
    usedPositionalFallback: false,
    unit: 'kg',
    unitSource: 'setting',
    rowsRead: 0,
    setsParsed: 0,
    workingSets: 0,
    warmupSets: 0,
    dropSets: 0,
    restRowsSeen: 0,
    restRowsCollapsed: 0,
    orphanRestRows: 0,
    duplicateRestRows: 0,
    malformedRestRows: 0,
    unknownTokens: [],
    dateParseFailures: 0,
    zeroRepSets: 0,
    isometricSets: 0,
    distanceRows: 0,
    trimmedNames: [],
    nameCollisions: [],
    workoutCount: 0,
    exerciseNames: [],
    dateRange: null,
  };
}
