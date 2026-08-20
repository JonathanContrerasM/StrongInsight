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
