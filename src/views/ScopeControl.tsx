import { useCallback, useState } from 'react';
import {
  SCOPE_OPTIONS,
  isScopeRange,
  monthsBefore,
  type Scope,
  type ScopeRange,
} from '../derive/buckets';
import { formatDate } from '../format';
import { SegmentedControl } from '../ui/primitives';
import { Popover } from '../ui/Popover';
import { DateRangePicker } from '../ui/DateRangePicker';

/**
 * The date-range scope, in the header so it reads as app-wide: one control,
 * every analytical tab follows it. Import, the tagging tray and Compare do not,
 * and the control is hidden on those tabs rather than shown disabled, because a
 * disabled range on the Import page would raise a question it cannot answer.
 *
 * Values go through the segmented control as strings because its generic is a
 * string key; `null` (all) is spelled 'all' on the way in and out, and a custom
 * range 'custom'. Picking Custom seeds the window with whatever is on screen
 * and opens a calendar under the control; the segment then wears the range as
 * its label, so the header never grows a second row.
 */
export function ScopeControl({
  scope,
  onChange,
  dateRange,
  sessionDays,
  lastRecordAt,
  weekStartsOn,
}: {
  scope: Scope;
  onChange: (s: Scope) => void;
  /** First and last session of the corpus: what months count back from, and the bounds of a custom range. */
  dateRange: { from: Date; to: Date } | null;
  /** Every day with a session, as YYYY-MM-DD, from the whole corpus rather than the scope. */
  sessionDays: ReadonlySet<string>;
  /** The newest record in the corpus, for a "since last PR" preset; null when there is none. */
  lastRecordAt: Date | null;
  weekStartsOn: 0 | 1;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  const range = isScopeRange(scope) ? scope : null;
  const title =
    scope === null
      ? 'Every session in the export'
      : range
        ? 'Sessions from ' + formatDate(range.from) + ' to ' + formatDate(range.to) + ', both days included'
        : 'The last ' + scope + ' months before your last session' +
          (dateRange ? ' (' + dateRange.to.toLocaleDateString() + ')' : '');

  const options = [
    ...SCOPE_OPTIONS.map((o) => ({ value: o.value === null ? 'all' : String(o.value), label: o.label })),
    { value: 'custom', label: range ? describeScope(range)! : 'Custom' },
  ];

  function select(v: string) {
    if (v === 'custom') {
      if (!dateRange) return;
      if (!range) onChange(seedRange(scope, dateRange));
      setOpen(true);
      return;
    }
    setOpen(false);
    onChange(v === 'all' ? null : (Number(v) as Scope));
  }

  return (
    <div title={title} className="flex items-center gap-2">
      <span className="hud-label hidden sm:inline">Range</span>
      <Popover
        open={open && range !== null && dateRange !== null}
        onClose={close}
        label="Custom date range"
        anchor={
          <SegmentedControl
            label="Date range"
            value={range ? 'custom' : scope === null ? 'all' : String(scope)}
            options={options}
            onChange={select}
          />
        }
      >
        {range && dateRange && (
          <DateRangePicker
            value={range}
            onChange={onChange}
            min={dateRange.from}
            max={dateRange.to}
            enabledDays={sessionDays}
            weekStartsOn={weekStartsOn}
            presets={rangePresets(dateRange, lastRecordAt)}
            onDone={close}
            onClear={() => {
              onChange(null);
              close();
            }}
          />
        )}
      </Popover>
    </div>
  );
}

/** The window that is already showing, so Custom starts from it: the months back from the last session, or the whole corpus. */
export function seedRange(scope: Scope, dateRange: { from: Date; to: Date }): ScopeRange {
  if (isScopeRange(scope)) return scope;
  if (scope === null) return { from: dateRange.from, to: dateRange.to };
  const from = monthsBefore(dateRange.to, scope);
  return { from: from > dateRange.from ? from : dateRange.from, to: dateRange.to };
}

/**
 * One chip per calendar year the corpus touches, clamped to it, and "since last
 * PR" when there is one after the first session.
 */
export function rangePresets(
  dateRange: { from: Date; to: Date },
  lastRecordAt: Date | null,
): Array<{ label: string; range: ScopeRange }> {
  const out: Array<{ label: string; range: ScopeRange }> = [];
  for (let y = dateRange.from.getFullYear(); y <= dateRange.to.getFullYear(); y++) {
    const start = new Date(y, 0, 1);
    const end = new Date(y, 11, 31);
    out.push({
      label: String(y),
      range: { from: start < dateRange.from ? dateRange.from : start, to: end > dateRange.to ? dateRange.to : end },
    });
  }
  if (lastRecordAt && lastRecordAt > dateRange.from) {
    out.push({ label: 'Since last PR', range: { from: lastRecordAt, to: dateRange.to } });
  }
  return out;
}

/** How the scope reads in a sentence: null for all, "last 3 months", or "2025-01-01 → 2025-03-31". */
export function describeScope(scope: Scope): string | null {
  if (scope === null) return null;
  if (isScopeRange(scope)) return formatDate(scope.from) + ' → ' + formatDate(scope.to);
  return 'last ' + scope + ' months';
}
