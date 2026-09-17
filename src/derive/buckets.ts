/**
 * Time bucketing, shared by nearly every chart.
 *
 * All bucketing is LOCAL wall-clock, matching how the parser reads Strong's
 * timestamps. Using UTC here would shift sessions across day boundaries for
 * anyone west of Greenwich and silently mis-assign evening workouts.
 */

export type Granularity = 'day' | 'week' | 'month';
export type WeekStart = 0 | 1;

const DAY_MS = 86400000;

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** Local midnight of the given date. */
export function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function startOfWeek(d: Date, weekStartsOn: WeekStart): Date {
  const day = startOfDay(d);
  const diff = (day.getDay() - weekStartsOn + 7) % 7;
  day.setDate(day.getDate() - diff);
  return day;
}

export function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function bucketStart(d: Date, g: Granularity, weekStartsOn: WeekStart = 1): Date {
  switch (g) {
    case 'day':
      return startOfDay(d);
    case 'week':
      return startOfWeek(d, weekStartsOn);
    case 'month':
      return startOfMonth(d);
  }
}

/** Stable, sortable key for a bucket. Sorting these lexically sorts chronologically. */
export function bucketKey(d: Date, g: Granularity, weekStartsOn: WeekStart = 1): string {
  const s = bucketStart(d, g, weekStartsOn);
  if (g === 'month') return pad(s.getFullYear(), 4) + '-' + pad(s.getMonth() + 1);
  return pad(s.getFullYear(), 4) + '-' + pad(s.getMonth() + 1) + '-' + pad(s.getDate());
}

export function nextBucket(d: Date, g: Granularity): Date {
  const s = new Date(d.getTime());
  switch (g) {
    case 'day':
      s.setDate(s.getDate() + 1);
      return s;
    case 'week':
      s.setDate(s.getDate() + 7);
      return s;
    case 'month':
      s.setMonth(s.getMonth() + 1);
      return s;
  }
}

/**
 * Every bucket start from `from` to `to` inclusive, with NO gaps.
 *
 * Charts need the empty buckets to exist so a training break renders as a gap
 * rather than being silently compressed out of the axis. Callers distinguish
 * "no data" from "zero" by looking at the bucket's contents, not its absence.
 */
export function bucketRange(
  from: Date,
  to: Date,
  g: Granularity,
  weekStartsOn: WeekStart = 1,
): Date[] {
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return [];
  const out: Date[] = [];
  let cur = bucketStart(from, g, weekStartsOn);
  const end = bucketStart(to, g, weekStartsOn);
  // Bounded so a pathological range cannot lock the tab up.
  for (let guard = 0; cur.getTime() <= end.getTime() && guard < 20000; guard++) {
    out.push(new Date(cur.getTime()));
    cur = nextBucket(cur, g);
  }
  return out;
}

/** Whole days between two local dates, DST-safe (rounds rather than truncates). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / DAY_MS);
}

// --- the date-range scope -----------------------------------------------------

/** Months of history to look at, counted back from the last session; null is all of it. */
export type ScopeMonths = 3 | 6 | 12 | null;
export const SCOPE_OPTIONS: ReadonlyArray<{ value: ScopeMonths; label: string }> = [
  { value: 3, label: '3 m' },
  { value: 6, label: '6 m' },
  { value: 12, label: '12 m' },
  { value: null, label: 'All' },
];

/**
 * Local midnight, `months` calendar months before `d`, with the day clamped so
 * 31 March minus one month is 28 February rather than 3 March. Calendar months
 * rather than 30-day blocks, because "the last three months" to a person means
 * the same day of the month, not 90 days.
 */
export function monthsBefore(d: Date, months: number): Date {
  const y = d.getFullYear();
  const m = d.getMonth() - months;
  const lastDayOfTarget = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(d.getDate(), lastDayOfTarget));
}

/**
 * The sets inside the scope, anchored on the LAST SESSION rather than today.
 * That is the same rule the insights engine follows for recency, and the only
 * one that behaves against an export from three months ago -- anchored on the
 * wall clock, "last 3 months" of such a file would be empty.
 *
 * `null` returns the input by identity, so `all` costs nothing and every memo
 * keyed on the array keeps its cache.
 */
export function scopeSets<T extends { date: Date }>(sets: T[], months: ScopeMonths): T[] {
  if (months === null || sets.length === 0) return sets;
  let last = sets[0]!.date;
  for (const s of sets) if (s.date > last) last = s.date;
  const cutoff = monthsBefore(last, months);
  return sets.filter((s) => s.date >= cutoff);
}

export type Bucketed<T> = { key: string; start: Date; items: T[] };

/**
 * Group items into contiguous buckets spanning the full observed range.
 * Empty buckets are present with `items: []`.
 */
export function bucketBy<T>(
  items: T[],
  getDate: (item: T) => Date,
  g: Granularity,
  weekStartsOn: WeekStart = 1,
): Array<Bucketed<T>> {
  if (items.length === 0) return [];

  let min: Date | null = null;
  let max: Date | null = null;
  for (const it of items) {
    const d = getDate(it);
    if (Number.isNaN(d.getTime())) continue;
    if (min === null || d < min) min = d;
    if (max === null || d > max) max = d;
  }
  if (min === null || max === null) return [];

  const byKey = new Map<string, T[]>();
  for (const it of items) {
    const d = getDate(it);
    if (Number.isNaN(d.getTime())) continue;
    const k = bucketKey(d, g, weekStartsOn);
    const list = byKey.get(k);
    if (list) list.push(it);
    else byKey.set(k, [it]);
  }

  return bucketRange(min, max, g, weekStartsOn).map((start) => {
    const key = bucketKey(start, g, weekStartsOn);
    return { key, start, items: byKey.get(key) ?? [] };
  });
}

/** Short axis label for a bucket. */
export function formatBucket(start: Date, g: Granularity): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = months[start.getMonth()] ?? '';
  if (g === 'month') return m + ' ' + start.getFullYear();
  return m + ' ' + start.getDate();
}
