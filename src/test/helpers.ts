import type { BodyweightEntry, ExerciseMeta, ParsedSet } from '../model/types';
import { buildMetaIndex } from '../meta/metaIndex';
import { makeBodyweightResolver } from '../model/bodyweight';
import { enrichSets, type EnrichedSet } from '../model/effectiveLoad';

export const CRLF = '\r\n';

export const GERMAN_HEADERS =
  'Datum,Workout-Name,Dauer,Name der Übung,Reihenfolge festlegen,Gewicht,Wiederh.,Entfernung,Sekunden,Notizen,Workout-Notizen,RPE';

export const ENGLISH_HEADERS =
  'Date,Workout Name,Duration,Exercise Name,Set Order,Weight,Reps,Distance,Seconds,Notes,Workout Notes,RPE';

export type RowSpec = {
  date?: string;
  workout?: string;
  duration?: string;
  exercise?: string;
  setOrder?: string | number;
  weight?: number | string;
  reps?: number | string;
  distance?: number | string;
  seconds?: number | string;
  notes?: string;
  workoutNotes?: string;
  rpe?: string;
};

/** Build a CSV the way Strong does, so tests declare intent rather than bytes. */
export function makeCsv(
  rows: RowSpec[],
  opts: { headers?: string; delimiter?: string; eol?: string; trailingNewline?: boolean } = {},
): string {
  const d = opts.delimiter ?? ',';
  const eol = opts.eol ?? CRLF;
  const header = opts.headers ?? GERMAN_HEADERS;
  const headerLine = d === ',' ? header : header.split(',').join(d);

  const body = rows.map((r) => {
    const cells = [
      r.date ?? '2023-01-09 18:15:00',
      quote(r.workout ?? 'Abend-Workout'),
      r.duration ?? '1h',
      quote(r.exercise ?? 'Squat (Barbell)'),
      String(r.setOrder ?? 1),
      String(r.weight ?? 0),
      String(r.reps ?? 0),
      String(r.distance ?? 0),
      String(r.seconds ?? 0),
      quote(r.notes ?? ''),
      quote(r.workoutNotes ?? ''),
      r.rpe ?? '',
    ];
    return cells.join(d);
  });

  return [headerLine, ...body].join(eol) + (opts.trailingNewline === false ? '' : eol);
}

function quote(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

export const GERMAN_WEIGHT_HEADERS = 'Datum,Measurement Type,Value,Unit,Source';

export type WeightRowSpec = {
  date?: string;
  type?: string;
  value?: number | string;
  unit?: string;
  source?: string;
};

/** The measurements export, same intent-over-bytes idea as `makeCsv`. */
export function makeBodyweightCsv(
  rows: WeightRowSpec[],
  opts: { headers?: string; delimiter?: string; eol?: string; trailingNewline?: boolean } = {},
): string {
  const d = opts.delimiter ?? ',';
  const eol = opts.eol ?? CRLF;
  const header = opts.headers ?? GERMAN_WEIGHT_HEADERS;
  const headerLine = d === ',' ? header : header.split(',').join(d);

  const body = rows.map((r) =>
    [
      r.date ?? '2023-03-01 08:00:00',
      r.type ?? 'Gewicht',
      String(r.value ?? 80),
      r.unit ?? 'kg',
      r.source ?? 'Strong',
    ].join(d),
  );

  return [headerLine, ...body].join(eol) + (opts.trailingNewline === false ? '' : eol);
}

/** Enrich parser output with hand-built metadata, the way the app does. */
export function enrich(
  sets: ParsedSet[],
  meta: Record<string, ExerciseMeta>,
  bodyweight: BodyweightEntry[] = [],
  fallbackKg: number | null = null,
): EnrichedSet[] {
  return enrichSets(sets, buildMetaIndex(meta), makeBodyweightResolver(bodyweight, fallbackKg));
}

export function meta(name: string, patch: Partial<ExerciseMeta> = {}): ExerciseMeta {
  return {
    name,
    equipment: 'unknown',
    loadType: 'external',
    primaryMuscle: 'unknown',
    secondaryMuscles: [],
    pattern: 'unknown',
    unilateral: false,
    confirmed: true,
    ...patch,
  };
}
