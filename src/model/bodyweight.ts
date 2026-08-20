import type { BodyweightEntry } from './types';

/**
 * The user maintains bodyweight manually. 31% of this corpus is bodyweight work,
 * so without it a third of training computes to zero volume.
 */

export type BodyweightResolver = {
  (date: Date): number | null;
  /** True when there are no recorded entries and we are on the configured default. */
  readonly isFallback: boolean;
  readonly entryCount: number;
};

function toTime(iso: string): number {
  // Dates are stored as plain YYYY-MM-DD; parse as local noon to dodge DST edges.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0).getTime();
}

export function sortBodyweight(entries: BodyweightEntry[]): BodyweightEntry[] {
  return entries
    .filter((e) => Number.isFinite(e.kg) && e.kg > 0 && Number.isFinite(toTime(e.date)))
    .slice()
    .sort((a, b) => toTime(a.date) - toTime(b.date));
}

/**
 * Linear interpolation between recorded entries, clamped at both ends.
 * With no entries at all, returns `fallbackKg` (or null when none is configured)
 * rather than silently computing zeros.
 */
export function makeBodyweightResolver(
  entries: BodyweightEntry[],
  fallbackKg: number | null,
): BodyweightResolver {
  const sorted = sortBodyweight(entries);
  const times = sorted.map((e) => toTime(e.date));

  const fn = ((date: Date): number | null => {
    if (sorted.length === 0) return fallbackKg;
    const t = date.getTime();
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    const tFirst = times[0];
    const tLast = times[times.length - 1];
    if (!first || !last || tFirst === undefined || tLast === undefined) return fallbackKg;

    if (t <= tFirst) return first.kg; // clamp low
    if (t >= tLast) return last.kg; // clamp high

    // Find the bracketing pair.
    for (let i = 1; i < sorted.length; i++) {
      const tb = times[i];
      const ta = times[i - 1];
      const a = sorted[i - 1];
      const b = sorted[i];
      if (ta === undefined || tb === undefined || !a || !b) continue;
      if (t <= tb) {
        if (tb === ta) return b.kg;
        const ratio = (t - ta) / (tb - ta);
        return a.kg + (b.kg - a.kg) * ratio;
      }
    }
    return last.kg;
  }) as BodyweightResolver;

  Object.defineProperty(fn, 'isFallback', { value: sorted.length === 0, enumerable: true });
  Object.defineProperty(fn, 'entryCount', { value: sorted.length, enumerable: true });
  return fn;
}

/** Convenience for tests and one-off lookups. */
export function bodyweightAt(
  entries: BodyweightEntry[],
  date: Date,
  fallbackKg: number | null = null,
): number | null {
  return makeBodyweightResolver(entries, fallbackKg)(date);
}
