import Papa from 'papaparse';
import type { ParsedSet, SetKind, WeightUnit, Workout } from '../model/types';
import { sniffDelimiter } from './sniffDelimiter';
import { mapHeaders, type Column } from './headerMap';
import { classifyRow } from './classifyRow';
import { parseDuration } from './parseDuration';
import { emptyReport, type ImportReport } from './report';

/**
 * NOTE: src/ingest must never import from src/meta or src/store. Parsing must not
 * depend on metadata, or a tagging keystroke re-parses the whole corpus.
 */

export type ParseOptions = {
  filename?: string;
  importedAt?: number;
  /** Unit this export was recorded in. A header suffix wins over this when present. */
  unit?: WeightUnit;
};

export type ParseResult = {
  workouts: Workout[];
  sets: ParsedSet[];
  report: ImportReport;
};

export const LB_TO_KG = 0.45359237;

export function toNumber(raw: string | undefined): number | null {
  if (raw == null) return null;
  const s = raw.trim();
  if (s === '') return null;
  // Tolerate a decimal comma; Strong emits a decimal point, but locales vary.
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/**
 * Strong writes local wall-clock time with no offset ("2023-01-09 18:15:00").
 * Parse it as local time explicitly -- new Date(string) treats a bare "YYYY-MM-DD"
 * as UTC and shifts the day backwards west of Greenwich.
 */
export function parseStrongDate(raw: string | undefined): Date | null {
  if (raw == null) return null;
  const s = raw.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) {
    const fallback = new Date(s);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const d = new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4] ?? 0),
    Number(m[5] ?? 0),
    Number(m[6] ?? 0),
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Canonical local wall-clock key. Stable across DST and export format changes. */
function dateKey(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    p(d.getFullYear(), 4) +
    '-' +
    p(d.getMonth() + 1) +
    '-' +
    p(d.getDate()) +
    'T' +
    p(d.getHours()) +
    ':' +
    p(d.getMinutes()) +
    ':' +
    p(d.getSeconds())
  );
}

/** Small, fast, dependency-free string hash (FNV-1a, base36). */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export function parseCsv(text: string, opts: ParseOptions = {}): ParseResult {
  const filename = opts.filename ?? 'unknown.csv';
  const importedAt = opts.importedAt ?? 0;
  const report = emptyReport(filename, importedAt);

  const sets: ParsedSet[] = [];
  const workouts: Workout[] = [];

  if (text.trim() === '') return { workouts, sets, report };

  const sniff = sniffDelimiter(text);
  report.delimiter = sniff.delimiter;
  report.delimiterConfident = sniff.confident;

  const parsed = Papa.parse<string[]>(text, {
    delimiter: sniff.delimiter,
    skipEmptyLines: 'greedy',
  });

  const rows = parsed.data;
  if (rows.length === 0) return { workouts, sets, report };

  const headerRow = (rows[0] ?? []).map((h) => String(h ?? ''));
  const mapping = mapHeaders(headerRow); // throws HeaderMappingError, by design
  report.headersUnrecognised = mapping.unrecognised;
  report.usedPositionalFallback = mapping.usedPositionalFallback;
  report.headersRecognised = headerRow.filter((h) => !mapping.unrecognised.includes(h));

  const unit: WeightUnit = mapping.weightUnitFromHeader ?? opts.unit ?? 'kg';
  report.unit = unit;
  report.unitSource = mapping.weightUnitFromHeader ? 'header' : 'setting';
  const toKg = (w: number | null) => (w === null ? null : unit === 'lb' ? w * LB_TO_KG : w);

  const at = (row: string[], col: Column): string | undefined => {
    const i = mapping.index[col];
    return i === undefined ? undefined : row[i];
  };

  // --- cursor state for the single forward pass -------------------------------
  let curWorkoutKey: string | null = null;
  let curWorkout: Workout | null = null;
  let curExercise: string | null = null;
  let ordinal = 0;
  /** Index into `sets` of the last emitted set in the CURRENT exercise scope. */
  let lastSetIdx: number | null = null;

  const workoutDupCount = new Map<string, number>();
  const setIdDupCount = new Map<string, number>();
  const exerciseNames = new Set<string>();
  const trimmedToRaw = new Map<string, string>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;
    // A trailing unterminated line still parses; a truly blank one does not count.
    if (row.length === 1 && String(row[0] ?? '').trim() === '') continue;
    report.rowsRead++;
    const line = r + 1; // 1-based file line number, for the report

    const date = parseStrongDate(at(row, 'date'));
    if (date === null) {
      report.dateParseFailures++;
      continue;
    }

    const workoutName = (at(row, 'workoutName') ?? '').trim();
    const rawExercise = at(row, 'exerciseName') ?? '';
    const exerciseName = rawExercise.trim();

    // Whitespace-dirty names are trimmed for the join key, but the trim is reported
    // so a future export that makes two names collide cannot do so silently.
    if (rawExercise !== exerciseName && exerciseName !== '') {
      if (!report.trimmedNames.includes(rawExercise)) report.trimmedNames.push(rawExercise);
    }
    const priorRaw = trimmedToRaw.get(exerciseName);
    if (priorRaw === undefined) {
      trimmedToRaw.set(exerciseName, rawExercise);
    } else if (priorRaw !== rawExercise && !report.nameCollisions.includes(exerciseName)) {
      report.nameCollisions.push(exerciseName);
    }

    // --- workout boundary -----------------------------------------------------
    const wKeyBase = dateKey(date) + '|' + workoutName;
    if (wKeyBase !== curWorkoutKey) {
      const seen = workoutDupCount.get(wKeyBase) ?? 0;
      // Only suffix on a genuine duplicate, so the common case matches the plain formula.
      const wid = hash(seen === 0 ? wKeyBase : wKeyBase + '|' + seen);
      workoutDupCount.set(wKeyBase, seen + 1);

      curWorkout = {
        id: wid,
        date,
        name: workoutName,
        durationSec: parseDuration(at(row, 'duration')) ?? 0,
        setIds: [],
      };
      workouts.push(curWorkout);
      curWorkoutKey = wKeyBase;
      // Crossing a workout boundary resets rest scope AND the ordinal counter.
      curExercise = null;
      lastSetIdx = null;
      ordinal = 0;
    }

    // --- exercise boundary ----------------------------------------------------
    if (exerciseName !== curExercise) {
      curExercise = exerciseName;
      ordinal = 0;
      // Rest must never attach backwards across an exercise boundary.
      lastSetIdx = null;
    }

    const weight = toKg(toNumber(at(row, 'weight')));
    const reps = toNumber(at(row, 'reps'));
    const seconds = toNumber(at(row, 'seconds'));
    const distance = toNumber(at(row, 'distance'));

    const kind = classifyRow({
      setOrder: at(row, 'setOrder') ?? '',
      weight,
      reps,
      seconds,
    });

    if (kind.kind === 'rest') {
      report.restRowsSeen++;
      if (lastSetIdx === null) {
        // First row of a workout or exercise: there is nothing to attach to, and we
        // must never look backwards past the boundary.
        report.orphanRestRows++;
        continue;
      }
      if (!Number.isFinite(kind.sec) || kind.sec <= 0) {
        report.malformedRestRows++;
        continue;
      }
      const target = sets[lastSetIdx];
      if (target) {
        // Consecutive rest rows: last write wins. These are timer SETTINGS, not
        // elapsed intervals -- summing them would be actively wrong.
        if (target.restAfterSec !== null) report.duplicateRestRows++;
        target.restAfterSec = kind.sec;
      }
      report.restRowsCollapsed++;
      continue;
    }

    if (kind.kind === 'unknown') {
      report.unknownTokens.push({ raw: kind.raw, line, exerciseName });
      continue;
    }

    const setKind: SetKind =
      kind.kind === 'warmup' ? 'warmup' : kind.kind === 'dropset' ? 'dropset' : 'working';

    ordinal++;
    const idBase = dateKey(date) + '|' + exerciseName + '|' + ordinal;
    const dup = setIdDupCount.get(idBase) ?? 0;
    setIdDupCount.set(idBase, dup + 1);
    const id = hash(idBase + '|' + dup);

    const set: ParsedSet = {
      id,
      workoutId: curWorkout?.id ?? '',
      date,
      exerciseName,
      setKind,
      setOrder: ordinal,
      weightKg: weight,
      reps,
      distanceRaw: distance,
      seconds,
      rpe: toNumber(at(row, 'rpe')),
      notes: (at(row, 'notes') ?? '').trim(),
      restAfterSec: null,
    };

    sets.push(set);
    lastSetIdx = sets.length - 1;
    curWorkout?.setIds.push(id);

    exerciseNames.add(exerciseName);
    report.setsParsed++;
    if (setKind === 'working') report.workingSets++;
    else if (setKind === 'warmup') report.warmupSets++;
    else report.dropSets++;

    if ((reps ?? 0) === 0 && (weight ?? 0) !== 0) report.zeroRepSets++;
    if ((seconds ?? 0) > 0) report.isometricSets++;
    if ((distance ?? 0) !== 0) report.distanceRows++;

    if (minDate === null || date < minDate) minDate = date;
    if (maxDate === null || date > maxDate) maxDate = date;
  }

  report.workoutCount = workouts.length;
  report.exerciseNames = [...exerciseNames].sort((a, b) => a.localeCompare(b));
  report.dateRange = minDate && maxDate ? { from: minDate, to: maxDate } : null;

  return { workouts, sets, report };
}
