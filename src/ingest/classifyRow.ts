/**
 * The set-order column is a tagged union, not a number:
 *   "1".."27"   working set (ordinal)
 *   "W"         warm-up
 *   "D"         drop set
 *   "Ruhezeit"  rest-timer row (localised: "Rest Timer")
 */

export type RowKind =
  | { kind: 'set'; order: number }
  | { kind: 'rest'; sec: number }
  | { kind: 'warmup' }
  | { kind: 'dropset' }
  | { kind: 'unknown'; raw: string };

export function normalizeToken(raw: string | undefined | null): string {
  if (raw == null) return '';
  return raw
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export const REST_TOKENS = new Set([
  'ruhezeit',
  'rest timer',
  'resttimer',
  'rest',
  'pause',
  'descanso',
  'repos',
  'riposo',
]);
export const WARMUP_TOKENS = new Set(['w', 'warmup', 'warm up', 'warm-up', 'aufwarmen', 'calentamiento']);
export const DROPSET_TOKENS = new Set(['d', 'drop', 'dropset', 'drop set', 'reduktionssatz']);

export type ClassifiableRow = {
  setOrder: string;
  weight: number | null;
  reps: number | null;
  seconds: number | null;
};

/**
 * ORDER IS LOAD-BEARING -- DO NOT REORDER.
 *
 * The numeric check MUST come first. In the reference fixture all 81 isometric-hold
 * rows (Handstand Hold, Wall Sit, Side Plank, Plank, deadhang) carry seconds > 0,
 * reps == 0 AND weight == 0 -- structurally identical to a rest row. The ONLY thing
 * distinguishing them is their numeric set-order. Running the structural rest test
 * before the numeric test silently swallows all 81 as rest rows.
 *
 * The structural test still earns its place: it catches a rest row whose token is
 * localised into a language we don't know, before we fall through to `unknown`.
 */
export function classifyRow(r: ClassifiableRow): RowKind {
  const n = Number(r.setOrder);
  if (Number.isInteger(n) && n > 0) return { kind: 'set', order: n };

  const sec = r.seconds ?? 0;
  if (sec > 0 && !r.reps && !r.weight) return { kind: 'rest', sec };

  const t = normalizeToken(r.setOrder);
  if (REST_TOKENS.has(t)) return { kind: 'rest', sec };
  if (WARMUP_TOKENS.has(t)) return { kind: 'warmup' };
  if (DROPSET_TOKENS.has(t)) return { kind: 'dropset' };

  return { kind: 'unknown', raw: r.setOrder };
}
