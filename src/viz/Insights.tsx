import { AxisLeft, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { ChartFrame, HoverLayer } from '../charts/ChartFrame';
import { AXIS, CONTRAST, MUTED, PRIMARY } from '../charts/colour';
import { bandScale, linearScale } from '../charts/scale';

/**
 * The two charts the Improvements cards need, and nothing more.
 *
 * Both exist to show the READER what the engine measured, including the
 * comparison it measured against -- a bare bar chart of weekday counts would
 * make every weekday look like a finding. The reference line is the point.
 */

export type WeekdayRate = {
  /** 0 = Sunday, matching Date.getDay(). */
  weekday: number;
  trained: number;
  available: number;
};

const SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Training rate per weekday against the overall rate.
 *
 * `flagged` is the weekday the finding is about; everything else is context. The
 * dashed reference line is what makes the chart honest: without it a 25% bar and
 * a 41% bar look equally like problems.
 */
export function WeekdayBars({
  rates,
  overall,
  flagged,
  weekStartsOn,
  height = 120,
}: {
  rates: WeekdayRate[];
  overall: number;
  flagged?: number;
  weekStartsOn: 0 | 1;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();
  if (rates.length === 0) return <NotEnoughData need="No sessions yet." />;

  // Rotate so the week starts where the user's settings say it does.
  const order = Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
  const byDay = new Map(rates.map((r) => [r.weekday, r]));
  const cols = order.map((wd) => byDay.get(wd) ?? { weekday: wd, trained: 0, available: 0 });
  const max = Math.max(overall, ...cols.map((c) => (c.available > 0 ? c.trained / c.available : 0)));

  return (
    <div>
      <ChartFrame height={height} label="Training rate by weekday" margin={{ left: 36 }}>
        {({ innerW, innerH }) => {
          const x = bandScale(7, [0, innerW], 0.25);
          const y = linearScale([0, max * 1.1], [innerH, 0]);
          return (
            <>
              <AxisLeft
                scale={y}
                innerW={innerW}
                tickCount={3}
                format={(v) => Math.round(v * 100) + '%'}
              />
              {cols.map((c, i) => {
                const rate = c.available > 0 ? c.trained / c.available : 0;
                const isFlagged = c.weekday === flagged;
                return (
                  <g key={c.weekday}>
                    <rect
                      x={x(i)}
                      y={y(rate)}
                      width={x.bandwidth}
                      height={Math.max(0, innerH - y(rate))}
                      fill={isFlagged ? CONTRAST : PRIMARY}
                      opacity={isFlagged || flagged === undefined ? 1 : 0.45}
                    />
                    <text
                      x={x(i) + x.bandwidth / 2}
                      y={innerH + 12}
                      fontSize={9}
                      textAnchor="middle"
                      fill={AXIS}
                    >
                      {SHORT[c.weekday]}
                    </text>
                  </g>
                );
              })}
              {/* The comparison the finding was actually made against. */}
              <line
                x1={0}
                x2={innerW}
                y1={y(overall)}
                y2={y(overall)}
                stroke={MUTED}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  const i = x.indexAt(px);
                  return i < 0 ? null : i;
                }}
                onHover={(i, pos) => {
                  if (i === null || !pos) return hide();
                  const c = cols[i];
                  if (!c) return hide();
                  const rate = c.available > 0 ? c.trained / c.available : 0;
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">{SHORT[c.weekday]}</div>
                      <div className="text-dim">
                        {c.trained} of {c.available} ({Math.round(rate * 100)}%)
                      </div>
                      <div className="text-dim">
                        {Math.round(overall * 100)}% across all days
                      </div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <Tooltip state={tip} />
    </div>
  );
}

/**
 * A bare trend line for a finding card: the series, and the fit the engine
 * tested. No axes -- the card's text carries the numbers, the shape carries the
 * story.
 */
export function Sparkline({
  values,
  trend,
  height = 56,
  label,
}: {
  values: number[];
  /** [yAtFirst, yAtLast] of the fitted line, in the same units as `values`. */
  trend?: [number, number];
  height?: number;
  label: string;
}) {
  if (values.length < 2) return <NotEnoughData need="Needs at least 2 points." />;

  const lo = Math.min(...values, ...(trend ?? []));
  const hi = Math.max(...values, ...(trend ?? []));

  return (
    <ChartFrame height={height} label={label} margin={{ left: 4, right: 4, top: 6, bottom: 6 }}>
      {({ innerW, innerH }) => {
        const x = linearScale([0, values.length - 1], [0, innerW]);
        const y = linearScale([lo, hi], [innerH, 0]);
        const path = values.map((v, i) => (i === 0 ? 'M' : 'L') + x(i) + ',' + y(v)).join(' ');
        return (
          <>
            <path d={path} fill="none" stroke={PRIMARY} strokeWidth={1.5} />
            {trend && (
              <line
                x1={x(0)}
                y1={y(trend[0])}
                x2={x(values.length - 1)}
                y2={y(trend[1])}
                stroke={CONTRAST}
                strokeWidth={1.5}
                strokeDasharray="4 3"
              />
            )}
          </>
        );
      }}
    </ChartFrame>
  );
}
