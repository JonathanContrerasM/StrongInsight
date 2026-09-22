import { useState } from 'react';
import { Button } from './primitives';

/**
 * A two-month calendar for picking a range of days, where only some days may
 * be picked: the caller passes the set of days that carry data, and every
 * other day is shown but inert. Two clicks make a range, in either order, and
 * the first click already applies as a one-day range so the page underneath
 * follows live. Hand-rolled, like every other control here: the app ships no
 * UI library, and a picker that knows which days had sessions is not a thing
 * a library would give us anyway.
 *
 * Dates are whole local days; times on `value`, `min` and `max` are ignored.
 */

export type DayRange = { from: Date; to: Date };

const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** YYYY-MM-DD in local time: the key format the caller's `enabledDays` uses. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function ordered(a: Date, b: Date): DayRange {
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

export function DateRangePicker({
  value,
  onChange,
  min,
  max,
  enabledDays,
  weekStartsOn,
  presets,
  onDone,
  onClear,
}: {
  value: DayRange;
  onChange: (next: DayRange) => void;
  /** The first and last day that can be shown at all. */
  min: Date;
  max: Date;
  /** Days that may be picked, as `dayKey` strings. */
  enabledDays: ReadonlySet<string>;
  weekStartsOn: 0 | 1;
  /** Ready-made windows, shown as chips above the calendar. */
  presets?: Array<{ label: string; range: DayRange }>;
  onDone?: () => void;
  /** Drop the range altogether; what that means is the caller's business. */
  onClear?: () => void;
}) {
  const firstMonth = startOfMonth(min);
  const lastMonth = startOfMonth(max);
  /**
   * The two panels page independently: the left one sticks to the month the
   * start was picked in, the right one roams ahead to find the end. The only
   * rule is that the right panel is always a later month than the left, and
   * both stay inside the corpus.
   */
  const clampMonths = (start: Date, end: Date): { start: Date; end: Date } => {
    const s0 = start < firstMonth ? firstMonth : start > lastMonth ? lastMonth : start;
    let e0 = end <= s0 ? addMonths(s0, 1) : end;
    if (e0 > lastMonth) e0 = lastMonth;
    return { start: s0, end: e0 };
  };
  // Open on the months the current range starts and ends in.
  const [months, setMonths] = useState(() =>
    clampMonths(startOfMonth(value.from), startOfMonth(value.to)),
  );
  const startMonth = months.start;
  const endMonth = months.end;
  /** The first day of a pair in progress. */
  const [anchor, setAnchor] = useState<Date | null>(null);
  const [hover, setHover] = useState<Date | null>(null);

  const preview = anchor && hover ? ordered(anchor, hover) : anchor ? { from: anchor, to: anchor } : value;
  const from = startOfDay(preview.from);
  const to = startOfDay(preview.to);

  function pick(d: Date) {
    if (anchor === null) {
      setAnchor(d);
      onChange({ from: d, to: d });
      // The left panel takes the start's month and stays there; the right
      // panel is pushed past it only if it has to be.
      setMonths((m) => clampMonths(startOfMonth(d), m.end));
    } else {
      onChange(ordered(anchor, d));
      setAnchor(null);
    }
  }

  const fromKey = dayKey(value.from);
  const toKey = dayKey(value.to);
  let picked = 0;
  for (const k of enabledDays) if (k >= fromKey && k <= toKey) picked++;

  function applyPreset(range: DayRange) {
    setAnchor(null);
    onChange(range);
    setMonths(clampMonths(startOfMonth(range.from), startOfMonth(range.to)));
  }
  const isCurrent = (r: DayRange) =>
    dayKey(r.from) === dayKey(value.from) && dayKey(r.to) === dayKey(value.to);

  const shared = { min, max, enabledDays, weekStartsOn, from, to, pick, setHover };
  const nudge = (which: 'start' | 'end', by: number) =>
    setMonths((m) =>
      which === 'start'
        ? clampMonths(addMonths(m.start, by), m.end)
        : clampMonths(m.start, addMonths(m.end, by)),
    );

  return (
    <div className="w-max max-w-[calc(100vw-2rem)]">
      {presets && presets.length > 0 && (
        <div className="mb-2 flex flex-wrap items-center gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={isCurrent(p.range)}
              onClick={() => applyPreset(p.range)}
              className={
                'rounded px-2 py-0.5 text-xs font-medium transition-colors ' +
                (isCurrent(p.range) ? 'bg-accent-bg text-accent-ink' : 'text-dim hover:bg-sunken hover:text-ink')
              }
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      <p className="text-center text-xs text-dim">
        {anchor ? 'Pick the other end of the range' : 'Pick a day to start a new range'}
      </p>
      <div className="mt-2 grid gap-4 sm:grid-cols-2" onMouseLeave={() => setHover(null)}>
        <MonthGrid
          month={startMonth}
          panel="start"
          canPrev={startMonth > firstMonth}
          canNext={addMonths(startMonth, 1) < endMonth}
          onNudge={(by) => nudge('start', by)}
          {...shared}
        />
        {endMonth > startMonth && (
          <div className="hidden sm:block">
            <MonthGrid
              month={endMonth}
              panel="end"
              canPrev={addMonths(endMonth, -1) > startMonth}
              canNext={endMonth < lastMonth}
              onNudge={(by) => nudge('end', by)}
              {...shared}
            />
          </div>
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-2">
        <span className="text-xs text-dim">
          <span className="num text-ink">{dayKey(value.from)}</span>
          {' → '}
          <span className="num text-ink">{dayKey(value.to)}</span>
          <span className="text-faint">
            {' · '}
            {picked} {picked === 1 ? 'session day' : 'session days'}
          </span>
        </span>
        <span className="flex items-center gap-1.5">
          {onClear && (
            <Button size="sm" variant="ghost" onClick={onClear}>
              Clear
            </Button>
          )}
          {onDone && (
            <Button size="sm" onClick={onDone}>
              Done
            </Button>
          )}
        </span>
      </div>
    </div>
  );
}

function MonthGrid({
  month,
  panel,
  canPrev,
  canNext,
  onNudge,
  min,
  max,
  enabledDays,
  weekStartsOn,
  from,
  to,
  pick,
  setHover,
}: {
  month: Date;
  panel: 'start' | 'end';
  canPrev: boolean;
  canNext: boolean;
  onNudge: (by: number) => void;
  min: Date;
  max: Date;
  enabledDays: ReadonlySet<string>;
  weekStartsOn: 0 | 1;
  from: Date;
  to: Date;
  pick: (d: Date) => void;
  setHover: (d: Date | null) => void;
}) {
  const minDay = startOfDay(min);
  const maxDay = startOfDay(max);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leading = (month.getDay() - weekStartsOn + 7) % 7;
  const labels = [...WEEKDAYS.slice(weekStartsOn), ...WEEKDAYS.slice(0, weekStartsOn)];

  const cells: Array<Date | null> = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(month.getFullYear(), month.getMonth(), day));

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          aria-label={'Previous month (' + panel + ')'}
          disabled={!canPrev}
          onClick={() => onNudge(-1)}
        >
          &lsaquo;
        </Button>
        <span className="text-xs font-medium text-ink">
          {month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={'Next month (' + panel + ')'}
          disabled={!canNext}
          onClick={() => onNudge(1)}
        >
          &rsaquo;
        </Button>
      </div>
      <div className="grid grid-cols-7 gap-0.5">
        {labels.map((l, i) => (
          <span key={i} className="hud-label py-1 text-center">
            {l}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={'blank-' + i} />;
          const key = dayKey(d);
          const enabled = enabledDays.has(key) && d >= minDay && d <= maxDay;
          const inRange = d >= from && d <= to;
          const endpoint = inRange && (d.getTime() === from.getTime() || d.getTime() === to.getTime());
          return (
            <button
              key={key}
              type="button"
              data-day={key}
              disabled={!enabled}
              aria-pressed={endpoint}
              onClick={() => pick(d)}
              onMouseEnter={() => enabled && setHover(d)}
              className={
                'num relative flex h-8 w-8 items-center justify-center rounded text-xs transition-colors ' +
                (endpoint
                  ? 'bg-accent text-accent-on'
                  : inRange
                    ? 'bg-accent-bg text-accent-ink'
                    : enabled
                      ? 'text-ink hover:bg-sunken'
                      : 'text-faint')
              }
            >
              {d.getDate()}
              {enabled && (
                <span
                  aria-hidden
                  className={
                    'absolute bottom-0.5 h-1 w-1 rounded-full ' + (endpoint ? 'bg-accent-on' : 'bg-accent')
                  }
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
