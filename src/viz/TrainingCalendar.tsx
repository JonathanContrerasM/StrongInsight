import { useMemo } from 'react';
import type { DayCell } from '../derive/series';
import {
  quantileBinner,
  EMPTY_FILL,
  EMPTY_STROKE,
  NEUTRAL_INK,
  categorical,
  AXIS,
  AXIS_TEXT,
} from '../charts/colour';
import { BinLegend, ChartCard, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { formatDate, formatDuration, formatVolume } from '../format';
import type { WeightUnit } from '../model/types';

const CELL = 11;
const GAP = 2;
const STEP = CELL + GAP;
const WEEKDAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

export type CalendarMode = 'intensity' | 'split';

/**
 * GitHub-style training calendar, one band per year so two years of data never
 * force horizontal scrolling.
 *
 * Three visual states, and keeping them distinct is the whole point: an untrained
 * day, a day trained with no countable load (pure bodyweight work), and a day
 * with volume. Letting a rest day share a fill with the lowest volume bin is the
 * classic calendar-heatmap lie.
 */
export function TrainingCalendar({
  days,
  unit,
  mode = 'intensity',
  clusterOf,
  clusterLabels,
  onSelectDay,
}: {
  days: DayCell[];
  unit: WeightUnit;
  mode?: CalendarMode;
  clusterOf?: (day: DayCell) => number | null;
  clusterLabels?: string[];
  onSelectDay?: (day: DayCell) => void;
}) {
  const { tip, show, hide } = useTooltip();

  const binner = useMemo(() => quantileBinner(days.map((d) => d.volumeKg), 5), [days]);

  const years = useMemo(() => {
    const byYear = new Map<number, DayCell[]>();
    for (const d of days) {
      const y = d.date.getFullYear();
      const list = byYear.get(y);
      if (list) list.push(d);
      else byYear.set(y, [d]);
    }
    return [...byYear.entries()].sort((a, b) => a[0] - b[0]);
  }, [days]);

  if (days.length === 0) return <NotEnoughData need="Import a CSV to see your training calendar." />;

  const fillFor = (d: DayCell): string => {
    if (!d.hasWorkout) return EMPTY_FILL;
    if (mode === 'split' && clusterOf) {
      const c = clusterOf(d);
      return c === null ? NEUTRAL_INK : categorical(c);
    }
    if (d.volumeKg <= 0) return EMPTY_FILL;
    return binner(d.volumeKg);
  };

  return (
    <div className="space-y-3">
      {years.map(([year, yearDays]) => {
        const first = yearDays[0];
        if (!first) return null;
        // Column index is the week offset from the first cell's week start.
        const originDay = new Date(first.date.getFullYear(), first.date.getMonth(), first.date.getDate());
        originDay.setDate(originDay.getDate() - originDay.getDay());

        const colOf = (d: Date) =>
          Math.floor((startOfDayMs(d) - originDay.getTime()) / (7 * 86400000));

        const cols = colOf(yearDays[yearDays.length - 1]!.date) + 1;
        const width = cols * STEP + 30;
        const height = 7 * STEP + 16;

        const monthTicks: Array<{ x: number; label: string }> = [];
        let lastMonth = -1;
        for (const d of yearDays) {
          const m = d.date.getMonth();
          if (m !== lastMonth && d.date.getDate() <= 7) {
            monthTicks.push({ x: 30 + colOf(d.date) * STEP, label: MONTHS[m] ?? '' });
            lastMonth = m;
          }
        }

        return (
          <div key={year} className="overflow-x-auto">
            <div className="mb-0.5 text-xs font-medium text-dim">{year}</div>
            <svg width={width} height={height} role="img" aria-label={'Training calendar ' + year}>
              {monthTicks.map((t, i) => (
                <text key={i} x={t.x} y={9} fontSize={9} fill={AXIS}>
                  {t.label}
                </text>
              ))}
              {WEEKDAY_LABELS.map((lbl, i) =>
                i % 2 === 1 ? (
                  <text key={i} x={0} y={16 + i * STEP + CELL - 2} fontSize={9} fill={AXIS}>
                    {lbl}
                  </text>
                ) : null,
              )}
              {yearDays.map((d) => {
                const x = 30 + colOf(d.date) * STEP;
                const y = 16 + d.date.getDay() * STEP;
                const trainedNoVolume = d.hasWorkout && d.volumeKg <= 0;
                return (
                  <g key={d.key}>
                    <rect
                      x={x}
                      y={y}
                      width={CELL}
                      height={CELL}
                      rx={2}
                      fill={fillFor(d)}
                      stroke={d.hasWorkout ? 'none' : EMPTY_STROKE}
                      style={{ cursor: d.hasWorkout && onSelectDay ? 'pointer' : 'default' }}
                      onMouseEnter={(e) =>
                        show(
                          e.clientX,
                          e.clientY,
                          <CalendarTip day={d} unit={unit} clusterLabels={clusterLabels} clusterOf={clusterOf} />,
                        )
                      }
                      onMouseLeave={hide}
                      onClick={() => d.hasWorkout && onSelectDay?.(d)}
                    />
                    {trainedNoVolume && (
                      <circle cx={x + CELL / 2} cy={y + CELL / 2} r={1.6} fill={AXIS_TEXT} />
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        );
      })}

      {mode === 'intensity' ? (
        <div className="flex flex-wrap items-center gap-4">
          <BinLegend
            ranges={binner.ranges}
            colors={Array.from({ length: binner.binCount }, (_, i) =>
              binner(binner.ranges[i]?.[1] ?? 1),
            )}
            format={(v) => formatVolume(v, unit)}
          />
          <span className="inline-flex items-center gap-1 text-xs text-dim">
            <span
              className="inline-block h-3 w-3 rounded-sm border"
              style={{ background: EMPTY_FILL, borderColor: EMPTY_STROKE }}
            />
            rest day
          </span>
          <span className="inline-flex items-center gap-1 text-xs text-dim">
            <span className="inline-block h-3 w-3 rounded-sm" style={{ background: EMPTY_FILL }} />
            trained, no countable load
          </span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
          {(clusterLabels ?? []).map((l, i) => (
            <span key={l + i} className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: categorical(i) }} />
              {l}
            </span>
          ))}
          <span className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: NEUTRAL_INK }} />
            mixed
          </span>
        </div>
      )}

      <p className="text-xs text-dim">
        Shades are quantiles of your own history, so a colour means &quot;busy for you&quot;, not an
        absolute amount.
      </p>
      <Tooltip state={tip} />
    </div>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDayMs(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function CalendarTip({
  day,
  unit,
  clusterLabels,
  clusterOf,
}: {
  day: DayCell;
  unit: WeightUnit;
  clusterLabels?: string[];
  clusterOf?: (d: DayCell) => number | null;
}) {
  if (!day.hasWorkout) {
    return (
      <div>
        <div className="font-medium">{formatDate(day.date)}</div>
        <div className="text-dim">Rest day</div>
      </div>
    );
  }
  const cluster = clusterOf?.(day);
  return (
    <div className="space-y-0.5">
      <div className="font-medium">{formatDate(day.date)}</div>
      <div className="text-dim">
        {day.setCount} sets &middot; {formatVolume(day.volumeKg, unit)}
        {day.durationSec > 0 && <> &middot; {formatDuration(day.durationSec)}</>}
      </div>
      {cluster !== null && cluster !== undefined && clusterLabels?.[cluster] && (
        <div className="text-dim">Split: {clusterLabels[cluster]}</div>
      )}
      <div className="text-dim">{day.exercises.slice(0, 6).join(', ')}
        {day.exercises.length > 6 ? ', ...' : ''}
      </div>
      {day.volumeKg <= 0 && (
        <div className="text-warn">No countable load (bodyweight or timed work)</div>
      )}
    </div>
  );
}

export function CalendarCard(props: Parameters<typeof TrainingCalendar>[0] & { actions?: React.ReactNode }) {
  const { actions, ...rest } = props;
  const trained = rest.days.filter((d) => d.hasWorkout).length;
  return (
    <ChartCard
      title="Training calendar"
      subtitle={
        rest.days.length > 0
          ? trained + ' sessions across ' + rest.days.length + ' days (' +
            Math.round((trained / rest.days.length) * 100) + '% of days trained)'
          : undefined
      }
      actions={actions}
    >
      <TrainingCalendar {...rest} />
    </ChartCard>
  );
}
