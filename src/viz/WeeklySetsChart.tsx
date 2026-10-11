import { BAND, FATIGUE, GOOD, MUTED } from '../charts/colour';
import { NotEnoughData } from '../charts/parts';
import { WEEKLY_SETS_TARGET, type VolumeStatus, type WeeklyVolume } from '../derive/recovery';
import { MUSCLE_LABEL } from './bodyRegions';

/**
 * Hard sets per muscle over the last 7 days, against the 10-20 guide band.
 *
 * Plain HTML bars rather than an SVG frame: one row per muscle, a shared scale,
 * and the band drawn behind every row so "inside / short / over" reads at a
 * glance without a legend lookup.
 */

const FILL: Record<VolumeStatus, string> = {
  under: MUTED,
  in: GOOD,
  over: FATIGUE[2],
};

const STATUS_TEXT: Record<VolumeStatus, string> = {
  under: 'below the band',
  in: 'in the band',
  over: 'above the band',
};

export function WeeklySetsChart({ rows }: { rows: readonly WeeklyVolume[] }) {
  if (rows.length === 0) return <NotEnoughData need="Nothing trained in the last four weeks." />;

  // Room past the band's top so "over" has somewhere to go.
  const max = Math.max(WEEKLY_SETS_TARGET.high * 1.25, ...rows.map((r) => r.sets));
  const pct = (v: number) => (v / max) * 100 + '%';

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div
          key={r.muscle}
          className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] items-center gap-3"
          title={MUSCLE_LABEL[r.muscle] + ': ' + r.sets.toFixed(1) + ' hard sets, ' + STATUS_TEXT[r.status]}
        >
          <span className="truncate text-xs text-dim">{MUSCLE_LABEL[r.muscle]}</span>
          <span className="relative block h-3 w-full overflow-hidden rounded-sm">
            <span
              aria-hidden
              className="absolute inset-y-0"
              style={{ left: pct(WEEKLY_SETS_TARGET.low), width: pct(WEEKLY_SETS_TARGET.high - WEEKLY_SETS_TARGET.low), background: BAND }}
            />
            <span
              className="absolute inset-y-0.5 left-0 rounded-sm"
              style={{ width: pct(Math.max(r.sets, 0.15)), background: FILL[r.status] }}
            />
          </span>
          <span className="num text-right text-xs text-ink">{r.sets.toFixed(1)}</span>
        </div>
      ))}
      <div className="grid grid-cols-[6.5rem_minmax(0,1fr)_3rem] gap-3 pt-1">
        <span />
        <span className="relative block h-4 text-[10px] text-faint">
          <span className="num absolute -translate-x-1/2" style={{ left: pct(WEEKLY_SETS_TARGET.low) }}>
            {WEEKLY_SETS_TARGET.low}
          </span>
          <span className="num absolute -translate-x-1/2" style={{ left: pct(WEEKLY_SETS_TARGET.high) }}>
            {WEEKLY_SETS_TARGET.high}
          </span>
        </span>
        <span />
      </div>
    </div>
  );
}
