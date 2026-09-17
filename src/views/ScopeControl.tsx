import { SCOPE_OPTIONS, type ScopeMonths } from '../derive/buckets';
import { SegmentedControl } from '../ui/primitives';

/**
 * The date-range scope, in the header so it reads as app-wide: one control,
 * every analytical tab follows it. Import, the tagging tray and Compare do not,
 * and the control is hidden on those tabs rather than shown disabled, because a
 * disabled range on the Import page would raise a question it cannot answer.
 *
 * Values go through the segmented control as strings because its generic is a
 * string key; `null` (all) is spelled 'all' on the way in and out.
 */
export function ScopeControl({
  scope,
  onChange,
  anchoredTo,
}: {
  scope: ScopeMonths;
  onChange: (s: ScopeMonths) => void;
  /** The last session, which the range counts back from. */
  anchoredTo: Date | null;
}) {
  const title =
    scope === null
      ? 'Every session in the export'
      : 'The last ' + scope + ' months before your last session' +
        (anchoredTo ? ' (' + anchoredTo.toLocaleDateString() + ')' : '');
  return (
    <div title={title} className="flex items-center gap-2">
      <span className="hud-label hidden sm:inline">Range</span>
      <SegmentedControl
        label="Date range"
        value={scope === null ? 'all' : String(scope)}
        options={SCOPE_OPTIONS.map((o) => ({
          value: o.value === null ? 'all' : String(o.value),
          label: o.label,
        }))}
        onChange={(v) => onChange(v === 'all' ? null : (Number(v) as ScopeMonths))}
      />
    </div>
  );
}
