import { useMemo } from 'react';
import type { VolumeMatrix } from '../derive/balance';
import type { BalancePoint } from '../derive/balance';
import type { LoadSplitPoint, SessionBest, SmoothedSessionBest } from '../derive/series';
import { segmentByGap } from '../derive/stats';
import {
  categorical,
  NEUTRAL_INK,
  PRIMARY,
  PRIMARY_SOFT,
  CONTRAST,
  GOOD,
  MUTED,
  BAND,
  AXIS,
} from '../charts/colour';
import { ChartFrame, HoverLayer } from '../charts/ChartFrame';
import { AxisLeft, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { bandScale, linearScale, timeScale } from '../charts/scale';
import { formatDate, formatVolume, formatWeight, toDisplayWeight } from '../format';
import type { WeightUnit } from '../model/types';

/** Gaps longer than this break the progression line rather than being bridged. */
const MAX_GAP_DAYS = 28;

// --- stacked volume -----------------------------------------------------------

/**
 * Weekly stacked bars rather than an area chart: an area must interpolate across
 * a week with no training, which invents data. Bars leave the gap visible.
 */
export function StackedVolume({
  matrix,
  unit,
  height = 220,
}: {
  matrix: VolumeMatrix;
  unit: WeightUnit;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();

  // Stack order is fixed by all-time total, never by per-bucket rank: a stack
  // that reshuffles between buckets is unreadable.
  const order = useMemo(() => {
    return matrix.groups
      .map((g, i) => ({ g, i, total: matrix.groupTotals[i] ?? 0 }))
      .sort((a, b) => {
        if (a.g === 'unknown') return 1;
        if (b.g === 'unknown') return -1;
        return b.total - a.total;
      });
  }, [matrix]);

  if (matrix.buckets.length === 0) return <NotEnoughData need="No volume to chart yet." />;

  const maxTotal = Math.max(...matrix.bucketTotals, 1);

  return (
    <div>
      <ChartFrame height={height} corners label="Volume over time by muscle group">
        {({ innerW, innerH }) => {
          const x = bandScale(matrix.buckets.length, [0, innerW], 0.15);
          const y = linearScale([0, toDisplayWeight(maxTotal, unit)], [innerH, 0]);

          return (
            <>
              <AxisLeft
                scale={y}
                innerW={innerW}
                format={(v) => (v >= 1000 ? (v / 1000).toFixed(0) + 't' : String(Math.round(v)))}
              />
              {matrix.buckets.map((b, bi) => {
                let acc = 0;
                return (
                  <g key={b.key}>
                    {order.map(({ g, i }, slot) => {
                      const v = matrix.cells[i]?.[bi]?.volumeKg ?? 0;
                      if (v <= 0) return null;
                      const y0 = y(toDisplayWeight(acc, unit));
                      acc += v;
                      const y1 = y(toDisplayWeight(acc, unit));
                      return (
                        <rect
                          key={g}
                          x={x(bi)}
                          y={y1}
                          width={x.bandwidth}
                          // 1px gap between segments instead of a stroke.
                          height={Math.max(0, y0 - y1 - 1)}
                          // Colour follows the group's fixed slot, never its rank
                          // within this bucket, so it never changes between bars.
                          fill={g === 'unknown' ? NEUTRAL_INK : categorical(slot)}
                        />
                      );
                    })}
                  </g>
                );
              })}
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  const i = x.indexAt(px);
                  return i < 0 ? null : i;
                }}
                onHover={(i, pos) => {
                  if (i === null || !pos) return hide();
                  const b = matrix.buckets[i];
                  if (!b) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">Week of {formatDate(b.start)}</div>
                      <div className="text-dim">
                        {formatVolume(matrix.bucketTotals[i] ?? 0, unit)} total
                      </div>
                      {order
                        .map(({ g, i: gi }) => ({ g, v: matrix.cells[gi]?.[i]?.volumeKg ?? 0 }))
                        .filter((r) => r.v > 0)
                        .slice(0, 6)
                        .map((r) => (
                          <div key={r.g} className="text-dim">
                            {r.g}: {formatVolume(r.v, unit)}
                          </div>
                        ))}
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
        {order.map(({ g }, idx) => (
          <span key={g} className="inline-flex items-center gap-1">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: g === 'unknown' ? NEUTRAL_INK : categorical(idx) }}
            />
            {g}
          </span>
        ))}
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

// --- strength progression -----------------------------------------------------

/**
 * Progression per SESSION, not per calendar month.
 *
 * Three layers answer three different questions: the dots are every session's
 * best (the honest spread, deloads included), the line is a rolling MEDIAN
 * (resistant to those deloads in a way a mean is not), and the step line is the
 * running best. Heaviest actual load is drawn separately because it is a
 * genuinely different question from estimated capability.
 */
export function ProgressionChart({
  points,
  unit,
  showHeaviest = true,
  height = 240,
}: {
  points: SmoothedSessionBest[];
  unit: WeightUnit;
  showHeaviest?: boolean;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();

  const withE1rm = points.filter((p) => p.bestE1rmKg !== null);
  if (withE1rm.length < 2) {
    return <NotEnoughData need="Needs at least 2 sessions with a resolvable load to chart progression." />;
  }

  const first = points[0]!.date;
  const last = points[points.length - 1]!.date;
  const values: number[] = [];
  for (const p of points) {
    if (p.bestE1rmKg !== null) values.push(p.bestE1rmKg);
    if (showHeaviest && p.heaviestKg !== null) values.push(p.heaviestKg);
  }
  const maxV = toDisplayWeight(Math.max(...values), unit);

  // Break the line across layoffs rather than drawing an invented straight line.
  const segments = useMemo(() => segmentByGap(points, MAX_GAP_DAYS), [points]);

  return (
    <div>
      <ChartFrame height={height} corners label="Strength progression">
        {({ innerW, innerH }) => {
          const x = timeScale([first, last], [0, innerW]);
          const y = linearScale([0, maxV * 1.08], [innerH, 0]);

          const pathFor = (
            seg: SmoothedSessionBest[],
            get: (p: SmoothedSessionBest) => number | null,
          ) => {
            let d = '';
            let pen = false;
            for (const p of seg) {
              const v = get(p);
              if (v === null) {
                pen = false;
                continue;
              }
              const px = x(p.date);
              const py = y(toDisplayWeight(v, unit));
              d += (pen ? 'L' : 'M') + px.toFixed(1) + ',' + py.toFixed(1) + ' ';
              pen = true;
            }
            return d;
          };

          return (
            <>
              <AxisLeft scale={y} innerW={innerW} format={(v) => String(Math.round(v))} />

              {showHeaviest &&
                segments.map((seg, i) => (
                  <path
                    key={'h' + i}
                    d={pathFor(seg.points, (p) => p.heaviestKg)}
                    fill="none"
                    stroke={MUTED}
                    strokeWidth={1.5}
                  />
                ))}

              {points.map((p) =>
                p.bestE1rmKg === null ? null : (
                  <circle
                    key={p.workoutId}
                    cx={x(p.date)}
                    cy={y(toDisplayWeight(p.bestE1rmKg, unit))}
                    r={2}
                    fill={PRIMARY_SOFT}
                  />
                ),
              )}

              {segments.map((seg, i) => (
                <path
                  key={'s' + i}
                  d={pathFor(seg.points, (p) => p.smoothedE1rmKg)}
                  fill="none"
                  stroke={PRIMARY}
                  strokeWidth={2}
                />
              ))}

              {segments.map((seg, i) => (
                <path
                  key={'p' + i}
                  d={pathFor(seg.points, (p) => p.prE1rmKg)}
                  fill="none"
                  stroke={GOOD}
                  strokeWidth={1.5}
                  strokeDasharray="4 3"
                />
              ))}

              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  let best: SmoothedSessionBest | null = null;
                  let bestD = Infinity;
                  for (const p of points) {
                    const d = Math.abs(x(p.date) - px);
                    if (d < bestD) {
                      bestD = d;
                      best = p;
                    }
                  }
                  return bestD < 24 ? best : null;
                }}
                onHover={(p, pos) => {
                  if (!p || !pos) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">{formatDate(p.date)}</div>
                      {p.bestE1rmKg !== null && (
                        <div className="text-dim">
                          Best e1RM {formatWeight(p.bestE1rmKg, unit, 1)}
                        </div>
                      )}
                      {p.heaviestKg !== null && (
                        <div className="text-dim">
                          Heaviest {formatWeight(p.heaviestKg, unit, 1)}
                        </div>
                      )}
                      {p.modalReps !== null && (
                        <div className="text-dim">Mostly {p.modalReps}-rep sets</div>
                      )}
                      {p.skippedSets > 0 && (
                        <div className="text-faint">
                          {p.skippedSets} set(s) not usable for e1RM
                        </div>
                      )}
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
        <Swatch color={PRIMARY_SOFT} label="session best e1RM" />
        <Swatch color={PRIMARY} label="rolling median (trend)" />
        <Swatch color={GOOD} label="personal best" dashed />
        {showHeaviest && <Swatch color={MUTED} label="heaviest actual load" />}
      </div>
      <p className="mt-1 text-xs text-dim">
        Trend is a rolling <strong>median</strong> across sessions, so deload weeks do not drag it
        down. Lines break across gaps longer than {MAX_GAP_DAYS} days rather than inventing progress.
      </p>
      <Tooltip state={tip} />
    </div>
  );
}

function Swatch({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span
        className="inline-block h-0.5 w-4"
        style={{
          background: dashed
            ? 'repeating-linear-gradient(90deg,' + color + ' 0 4px, transparent 4px 7px)'
            : color,
        }}
      />
      {label}
    </span>
  );
}

// --- bodyweight vs added load -------------------------------------------------

/**
 * The signature story of a bodyweight-heavy log: most Pull Up sets are logged at
 * weight 0 yet carry the athlete's full bodyweight. A raw weight chart shows
 * nothing but zeros; this shows the real load and where the added weight begins.
 */
export function LoadSplitChart({
  points,
  unit,
  height = 200,
}: {
  points: LoadSplitPoint[];
  unit: WeightUnit;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();
  const withData = points.filter((p) => p.totalKg !== null);
  if (withData.length < 2) {
    return <NotEnoughData need="Needs at least 2 periods of bodyweight-relative work." />;
  }

  const maxV = toDisplayWeight(Math.max(...withData.map((p) => p.totalKg ?? 0)), unit);

  return (
    <div>
      <ChartFrame height={height} corners label="Bodyweight versus added load">
        {({ innerW, innerH }) => {
          const x = bandScale(points.length, [0, innerW], 0.15);
          const y = linearScale([0, maxV * 1.1], [innerH, 0]);
          return (
            <>
              <AxisLeft scale={y} innerW={innerW} />
              {points.map((p, i) => {
                if (p.totalKg === null) return null;
                const base = Math.max(0, p.bodyweightKg ?? 0);
                const added = p.addedKg ?? 0;
                const yBase = y(toDisplayWeight(base, unit));
                const yTop = y(toDisplayWeight(base + Math.max(0, added), unit));
                return (
                  <g key={p.key}>
                    <rect
                      x={x(i)}
                      y={yBase}
                      width={x.bandwidth}
                      height={Math.max(0, innerH - yBase)}
                      fill={PRIMARY_SOFT}
                    />
                    {added > 0 && (
                      <rect
                        x={x(i)}
                        y={yTop}
                        width={x.bandwidth}
                        height={Math.max(0, yBase - yTop)}
                        fill={CONTRAST}
                      />
                    )}
                  </g>
                );
              })}
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  const i = x.indexAt(px);
                  return i < 0 ? null : i;
                }}
                onHover={(i, pos) => {
                  if (i === null || !pos) return hide();
                  const p = points[i];
                  if (!p) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">{formatDate(p.start)}</div>
                      <div className="text-dim">
                        Bodyweight {formatWeight(p.bodyweightKg, unit, 1)}
                      </div>
                      <div className="text-dim">
                        Added {formatWeight(p.addedKg, unit, 1)} (mean over {p.setCount} sets)
                      </div>
                      <div className="text-dim">
                        {p.loadedSetCount} of {p.setCount} sets carried extra load
                      </div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
        <Swatch color={PRIMARY_SOFT} label="bodyweight component" />
        <Swatch color={CONTRAST} label="added load" />
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

// --- balance ------------------------------------------------------------------

/**
 * Diverging bars on log2 of the ratio.
 *
 * log2 is the only honest axis for a two-sided ratio: 2:1 and 1:2 must sit
 * equidistant from centre, whereas on a raw ratio axis one lands at 2.0 and the
 * other at 0.5, squashing half the range into [0,1].
 */
export function BalanceChart({
  points,
  metric,
  labels,
  height = 160,
}: {
  points: BalancePoint[];
  metric: 'pullPushLog2' | 'lowerUpperLog2';
  labels: [string, string];
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();
  const withData = points.filter((p) => p[metric] !== null);
  if (withData.length < 2) return <NotEnoughData need="Needs at least 2 periods with both sides trained." />;

  const maxAbs = Math.max(1, ...withData.map((p) => Math.abs(p[metric] as number)));

  return (
    <div>
      <ChartFrame height={height} corners label={'Balance: ' + labels.join(' versus ')}>
        {({ innerW, innerH }) => {
          const x = bandScale(points.length, [0, innerW], 0.15);
          const y = linearScale([-maxAbs, maxAbs], [innerH, 0]);
          const zero = y(0);
          // Within 1.25x either way reads as balanced, not as a finding.
          const bandTop = y(0.32);
          const bandBottom = y(-0.32);
          return (
            <>
              <rect x={0} y={bandTop} width={innerW} height={bandBottom - bandTop} fill={BAND} />
              <line x1={0} x2={innerW} y1={zero} y2={zero} stroke={AXIS} />
              {points.map((p, i) => {
                const v = p[metric];
                if (v === null) return null;
                const py = y(v);
                return (
                  <rect
                    key={p.key}
                    x={x(i)}
                    y={Math.min(py, zero)}
                    width={x.bandwidth}
                    height={Math.max(1, Math.abs(py - zero))}
                    fill={v >= 0 ? PRIMARY : CONTRAST}
                  />
                );
              })}
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  const i = x.indexAt(px);
                  return i < 0 ? null : i;
                }}
                onHover={(i, pos) => {
                  if (i === null || !pos) return hide();
                  const p = points[i];
                  const v = p?.[metric];
                  if (!p || v === null || v === undefined) return hide();
                  const ratio = Math.pow(2, v);
                  return show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">{formatDate(p.start)}</div>
                      <div className="text-dim">
                        {ratio >= 1
                          ? ratio.toFixed(2) + '× more ' + labels[0]
                          : (1 / ratio).toFixed(2) + '× more ' + labels[1]}
                      </div>
                      {p.unconfirmedSets > 0 && (
                        <div className="text-warn">
                          {p.unconfirmedSets} of {p.setCount} sets use unverified tags
                        </div>
                      )}
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
        <Swatch color={PRIMARY} label={'more ' + labels[0]} />
        <Swatch color={CONTRAST} label={'more ' + labels[1]} />
        <span className="text-faint">grey band = within 1.25×, i.e. balanced</span>
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

// --- per-session peaks and workload -------------------------------------------

/**
 * Heaviest load per session AND total volume per session, as two facets sharing
 * one time axis.
 *
 * Two series rather than one because they answer different questions and, in real
 * data, genuinely disagree: in the reference corpus the highest-volume squat
 * session (3,360 kg) was done at only 60 kg, while a 100 kg day carried less
 * total work. Heaviest is also the noisier of the two -- deload and light days
 * sit in the same series as top sets -- which is exactly why the smoother
 * workload series belongs beside it.
 *
 * Two facets, never a dual axis: a shared y-axis between kilograms and total
 * volume would invent an alignment between them that does not exist.
 */
export function SessionPeaksChart({
  points,
  unit,
  height = 260,
}: {
  points: SessionBest[];
  unit: WeightUnit;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();

  const withLoad = points.filter((p) => p.heaviestKg !== null);
  if (points.length < 2) {
    return <NotEnoughData need="Needs at least 2 sessions to chart per-session peaks." />;
  }

  const first = points[0]!.date;
  const last = points[points.length - 1]!.date;
  const maxLoad = toDisplayWeight(Math.max(...withLoad.map((p) => p.heaviestKg as number), 1), unit);
  const maxVol = toDisplayWeight(Math.max(...points.map((p) => p.volumeKg), 1), unit);

  // Break the heaviest line across layoffs instead of bridging them.
  const segments = segmentByGap(points, MAX_GAP_DAYS);

  // Split the frame: load on top, workload below, with a gutter between.
  const GUTTER = 26;

  return (
    <div>
      <ChartFrame height={height} corners label="Heaviest load and volume per session">
        {({ innerW, innerH }) => {
          const loadH = Math.max(20, (innerH - GUTTER) * 0.58);
          const volH = Math.max(16, innerH - GUTTER - loadH);
          const x = timeScale([first, last], [0, innerW]);
          const yLoad = linearScale([0, maxLoad * 1.1], [loadH, 0]);
          const yVol = linearScale([0, maxVol * 1.1], [volH, 0]);
          // Bars are thin enough not to overlap at ~80 sessions.
          const barW = Math.max(2, Math.min(10, innerW / Math.max(1, points.length) - 1));

          const loadPath = segments
            .map((seg) => {
              let d = '';
              let pen = false;
              for (const p of seg.points) {
                if (p.heaviestKg === null) {
                  pen = false;
                  continue;
                }
                d +=
                  (pen ? 'L' : 'M') +
                  x(p.date).toFixed(1) +
                  ',' +
                  yLoad(toDisplayWeight(p.heaviestKg, unit)).toFixed(1) +
                  ' ';
                pen = true;
              }
              return d;
            })
            .join('');

          const nearest = (px: number): SessionBest | null => {
            let best: SessionBest | null = null;
            let bestD = Infinity;
            for (const p of points) {
              const d = Math.abs(x(p.date) - px);
              if (d < bestD) {
                bestD = d;
                best = p;
              }
            }
            return bestD < 24 ? best : null;
          };

          const tipFor = (p: SessionBest) => (
            <div className="space-y-0.5">
              <div className="font-medium">{formatDate(p.date)}</div>
              <div className="text-dim">
                Heaviest {p.heaviestKg === null ? 'n/a' : formatWeight(p.heaviestKg, unit, 1)}
              </div>
              <div className="text-dim">Volume {formatVolume(p.volumeKg, unit)}</div>
              <div className="text-dim">
                {p.setCount} set{p.setCount === 1 ? '' : 's'}
                {p.modalReps !== null && ' · mostly ' + p.modalReps + ' reps'}
              </div>
              {p.volumeKg === 0 && (
                <div className="text-warn">No countable load this session</div>
              )}
            </div>
          );

          return (
            <>
              {/* facet 1: heaviest load */}
              <AxisLeft scale={yLoad} innerW={innerW} tickCount={4} />
              <path d={loadPath} fill="none" stroke={PRIMARY} strokeWidth={2} />
              {points.map((p) =>
                p.heaviestKg === null ? null : (
                  <circle
                    key={p.workoutId}
                    cx={x(p.date)}
                    cy={yLoad(toDisplayWeight(p.heaviestKg, unit))}
                    r={2.5}
                    fill={PRIMARY}
                  />
                ),
              )}

              {/* facet 2: session volume */}
              <g transform={'translate(0,' + (loadH + GUTTER) + ')'}>
                <AxisLeft
                  scale={yVol}
                  innerW={innerW}
                  tickCount={3}
                  format={(v) => (v >= 1000 ? (v / 1000).toFixed(1) + 't' : String(Math.round(v)))}
                />
                {points.map((p) => {
                  const py = yVol(toDisplayWeight(p.volumeKg, unit));
                  return (
                    <rect
                      key={p.workoutId}
                      x={x(p.date) - barW / 2}
                      y={py}
                      width={barW}
                      height={Math.max(0, volH - py)}
                      fill={PRIMARY_SOFT}
                    />
                  );
                })}
              </g>

              {/* one hit surface over both facets, so they report the same session */}
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => nearest(px)}
                onHover={(p, pos) => {
                  if (!p || !pos) return hide();
                  show(pos.clientX, pos.clientY, tipFor(p));
                }}
              />
            </>
          );
        }}
      </ChartFrame>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-dim">
        <Swatch color={PRIMARY} label="heaviest load in the session" />
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: PRIMARY_SOFT }} />
          session volume
        </span>
      </div>
      <p className="mt-1 text-xs text-dim">
        Separate scales on purpose: the heaviest set and the total work done are different
        questions, and your heaviest session is often not your hardest one.
      </p>
      <Tooltip state={tip} />
    </div>
  );
}
