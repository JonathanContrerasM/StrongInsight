import { useMemo } from 'react';
import type { VolumeMatrix } from '../derive/balance';
import type { HabitMap, LoadRepDensity } from '../derive/profile';
import {
  diverging,
  sequential,
  EMPTY_FILL,
  EMPTY_STROKE,
  AXIS,
  INK_DIM,
  FLAG,
} from '../charts/colour';
import { ChartCard, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { sqrtScale } from '../charts/scale';
import { formatVolume, formatWeight } from '../format';
import type { WeightUnit } from '../model/types';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// --- muscle x week ------------------------------------------------------------

export type MuscleScale = 'relative' | 'absolute';

/**
 * Muscle (or pattern) by time.
 *
 * Defaults to ROW-RELATIVE colouring, which is the non-obvious but correct call.
 * On absolute volume this chart only ever says "legs are heavy" -- squat volume
 * dwarfs lateral raises by an order of magnitude, so every upper-body row goes
 * uniformly pale and the chart carries no information. Row-relative turns it into
 * "which weeks did I over- or under-do each muscle by my own standard", which is
 * the question actually worth asking.
 */
export function MuscleHeatmap({
  matrix,
  unit,
  scaleMode = 'relative',
}: {
  matrix: VolumeMatrix;
  unit: WeightUnit;
  scaleMode?: MuscleScale;
}) {
  const { tip, show, hide } = useTooltip();

  const rowMedians = useMemo(
    () =>
      matrix.cells.map((row) => {
        const nz = row.map((c) => c.volumeKg).filter((v) => v > 0).sort((a, b) => a - b);
        if (nz.length === 0) return 0;
        return nz[Math.floor(nz.length / 2)] ?? 0;
      }),
    [matrix],
  );

  if (matrix.groups.length === 0 || matrix.buckets.length === 0) {
    return <NotEnoughData need="No tagged volume yet." />;
  }

  const cell = matrix.buckets.length > 80 ? 7 : matrix.buckets.length > 40 ? 11 : 16;
  const rowH = 15;
  const labelW = 92;
  const width = labelW + matrix.buckets.length * cell;
  const height = matrix.groups.length * rowH + 18;

  const fillFor = (gi: number, bi: number): string => {
    const c = matrix.cells[gi]?.[bi];
    const bucketTotal = matrix.bucketTotals[bi] ?? 0;
    // Distinguish "no session that week" from "trained but nothing for this muscle".
    if (bucketTotal === 0) return EMPTY_FILL;
    if (!c || c.volumeKg <= 0) return EMPTY_FILL;
    if (scaleMode === 'absolute') {
      return sequential(matrix.maxCell > 0 ? 0.1 + (c.volumeKg / matrix.maxCell) * 0.9 : 0.1);
    }
    const med = rowMedians[gi] ?? 0;
    if (med <= 0) return sequential(0.5);
    // log2 of the ratio to this row's own median, clamped to +/-2.
    const t = Math.max(-1, Math.min(1, Math.log2(c.volumeKg / med) / 2));
    return diverging(t);
  };

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Muscle volume over time">
          {matrix.groups.map((g, gi) => (
            <text
              key={g}
              x={labelW - 6}
              y={gi * rowH + rowH / 2 + 14}
              dy="0.32em"
              textAnchor="end"
              fontSize={10}
              fill={g === 'unknown' ? AXIS : INK_DIM}
              fontStyle={g === 'unknown' ? 'italic' : undefined}
            >
              {g}
            </text>
          ))}
          <g transform={'translate(' + labelW + ',14)'}>
            {matrix.groups.map((g, gi) =>
              matrix.buckets.map((b, bi) => {
                const c = matrix.cells[gi]?.[bi];
                const unconfirmed = (c?.unconfirmedSets ?? 0) > 0 && (c?.setCount ?? 0) > 0
                  ? (c as { unconfirmedSets: number; setCount: number }).unconfirmedSets /
                    (c as { setCount: number }).setCount
                  : 0;
                return (
                  <rect
                    key={g + b.key}
                    x={bi * cell}
                    y={gi * rowH}
                    width={Math.max(1, cell - 1)}
                    height={rowH - 1}
                    fill={fillFor(gi, bi)}
                    // Amber ring: this cell leans on tags that are still guesses.
                    stroke={unconfirmed >= 0.25 ? FLAG : undefined}
                    strokeWidth={unconfirmed >= 0.25 ? 1 : 0}
                    onMouseEnter={(e) =>
                      show(
                        e.clientX,
                        e.clientY,
                        <div className="space-y-0.5">
                          <div className="font-medium">
                            {g} &middot; week of {b.start.toLocaleDateString()}
                          </div>
                          <div className="text-dim">
                            {c && c.volumeKg > 0 ? formatVolume(c.volumeKg, unit) : 'no volume'}
                            {c && c.setCount > 0 && ' from ' + c.setCount + ' sets'}
                          </div>
                          {(matrix.bucketTotals[bi] ?? 0) === 0 && (
                            <div className="text-dim">No sessions this week</div>
                          )}
                          {unconfirmed >= 0.25 && (
                            <div className="text-warn">
                              {c?.unconfirmedSets} of {c?.setCount} sets use unverified tags
                            </div>
                          )}
                        </div>,
                      )
                    }
                    onMouseLeave={hide}
                  />
                );
              }),
            )}
          </g>
        </svg>
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-dim">
        {scaleMode === 'relative' ? (
          <span className="inline-flex items-center gap-1.5">
            <span>below your norm</span>
            {[-1, -0.5, 0, 0.5, 1].map((t) => (
              <span
                key={t}
                className="inline-block h-3 w-4 rounded-sm border border-line"
                style={{ background: diverging(t) }}
              />
            ))}
            <span>above</span>
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <span>less</span>
            {[0.1, 0.3, 0.5, 0.7, 1].map((t) => (
              <span
                key={t}
                className="inline-block h-3 w-4 rounded-sm border border-line"
                style={{ background: sequential(t) }}
              />
            ))}
            <span>more volume</span>
          </span>
        )}
        <span className="inline-flex items-center gap-1">
          <span
            className="inline-block h-3 w-3 rounded-sm border"
            style={{ background: EMPTY_FILL, borderColor: EMPTY_STROKE }}
          />
          no sessions
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-sm" style={{ background: EMPTY_FILL }} />
          trained, none for this muscle
        </span>
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

// --- day-of-week x hour -------------------------------------------------------

export function HabitHeatmap({ habit, weekStartsOn }: { habit: HabitMap; weekStartsOn: 0 | 1 }) {
  const { tip, show, hide } = useTooltip();

  if (habit.totalWorkouts === 0) return <NotEnoughData need="No sessions yet." />;

  // An export with no time component puts everything at midnight; drawing that
  // as a heatmap invents a dramatic spike that is purely missing data.
  if (!habit.hasTimeOfDay) {
    const max = Math.max(...habit.weekdayTotals, 1);
    return (
      <div className="space-y-2">
        <p className="text-xs text-warn">
          This export has no time-of-day information, so only the weekday pattern is shown.
        </p>
        <div className="space-y-1">
          {orderDays(weekStartsOn).map((d) => (
            <div key={d} className="flex items-center gap-2 text-xs">
              <span className="w-8 text-dim">{WEEKDAYS[d]}</span>
              <div
                className="h-3 rounded-sm bg-accent"
                style={{ width: ((habit.weekdayTotals[d] ?? 0) / max) * 100 + '%' }}
              />
              <span className="tabular-nums text-dim">{habit.weekdayTotals[d] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Crop to observed hours: drawing 00-23 when everything happens at 17-20
  // wastes most of the canvas.
  const h0 = Math.max(0, habit.hourMin);
  const h1 = Math.min(23, habit.hourMax);
  const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
  const days = orderDays(weekStartsOn);

  const cellW = 22;
  const cellH = 18;
  const labelW = 34;
  const lookup = new Map(habit.cells.map((c) => [c.weekday + '|' + c.hour, c.workoutCount]));

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg
          width={labelW + hours.length * cellW}
          height={days.length * cellH + 20}
          role="img"
          aria-label="Training time habits"
        >
          {hours.map((h, i) => (
            <text key={h} x={labelW + i * cellW + cellW / 2} y={10} fontSize={9} textAnchor="middle" fill={AXIS}>
              {h}
            </text>
          ))}
          {days.map((d, di) => (
            <text key={d} x={labelW - 6} y={16 + di * cellH + cellH / 2} dy="0.32em" fontSize={10} textAnchor="end" fill={INK_DIM}>
              {WEEKDAYS[d]}
            </text>
          ))}
          <g transform={'translate(' + labelW + ',16)'}>
            {days.map((d, di) =>
              hours.map((h, hi) => {
                const count = lookup.get(d + '|' + h) ?? 0;
                return (
                  <rect
                    key={d + '-' + h}
                    x={hi * cellW}
                    y={di * cellH}
                    width={cellW - 2}
                    height={cellH - 2}
                    rx={2}
                    fill={count === 0 ? EMPTY_FILL : sequential(0.15 + (count / habit.maxCount) * 0.85)}
                    stroke={count === 0 ? EMPTY_STROKE : undefined}
                    onMouseEnter={(e) =>
                      show(
                        e.clientX,
                        e.clientY,
                        <div>
                          <div className="font-medium">
                            {WEEKDAYS[d]} at {String(h).padStart(2, '0')}:00
                          </div>
                          <div className="text-dim">
                            {count} session{count === 1 ? '' : 's'}
                          </div>
                        </div>,
                      )
                    }
                    onMouseLeave={hide}
                  />
                );
              }),
            )}
          </g>
        </svg>
      </div>
      <p className="text-xs text-dim">
        Hours cropped to {String(h0).padStart(2, '0')}:00&ndash;{String(h1).padStart(2, '0')}:00, the
        range you actually train in. Empty cells are genuinely zero.
      </p>
      <Tooltip state={tip} />
    </div>
  );
}

function orderDays(weekStartsOn: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, i) => (i + weekStartsOn) % 7);
}

// --- weight x reps density ----------------------------------------------------

export function DensityHeatmap({
  density,
  unit,
}: {
  density: LoadRepDensity;
  unit: WeightUnit;
}) {
  const { tip, show, hide } = useTooltip();

  if (density.cells.length === 0) {
    return <NotEnoughData need="No sets with a resolvable load and reps yet." />;
  }

  const reps = density.repValues;
  const loadBins = density.loadEdges.length - 1;
  const cellW = Math.max(10, Math.min(26, 420 / Math.max(1, reps.length)));
  const cellH = 16;
  const labelW = 64;
  const width = labelW + reps.length * cellW;
  const height = loadBins * cellH + 22;

  // sqrt: counts are small integers with one or two hot cells; linear buries
  // every singleton, and there are many.
  const colourAt = sqrtScale([0, density.maxCount], [0.12, 1]);

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <svg width={width} height={height} role="img" aria-label="Weight by reps density">
          {reps.map((r, i) => (
            <text key={r} x={labelW + i * cellW + cellW / 2} y={10} fontSize={9} textAnchor="middle" fill={AXIS}>
              {r}
            </text>
          ))}
          {Array.from({ length: loadBins }, (_, b) => {
            // Heaviest at the top, which is how lifters read a load axis.
            const row = loadBins - 1 - b;
            return (
              <text key={b} x={labelW - 6} y={18 + b * cellH + cellH / 2} dy="0.32em" fontSize={9} textAnchor="end" fill={INK_DIM} className="tabular-nums">
                {formatWeight(density.loadEdges[row] ?? 0, unit, 0)}
              </text>
            );
          })}
          <g transform={'translate(' + labelW + ',18)'}>
            {density.cells.map((c) => {
              const ri = reps.indexOf(c.repBin);
              if (ri < 0) return null;
              const row = loadBins - 1 - c.loadBin;
              return (
                <rect
                  key={c.repBin + '-' + c.loadBin}
                  x={ri * cellW}
                  y={row * cellH}
                  width={cellW - 1}
                  height={cellH - 1}
                  rx={1}
                  fill={sequential(colourAt(c.setCount))}
                  onMouseEnter={(e) =>
                    show(
                      e.clientX,
                      e.clientY,
                      <div>
                        <div className="font-medium">
                          {formatWeight(density.loadEdges[c.loadBin] ?? 0, unit, 0)}&ndash;
                          {formatWeight(density.loadEdges[c.loadBin + 1] ?? 0, unit, 0)} &times; {c.repBin} reps
                        </div>
                        <div className="text-dim">{c.setCount} sets</div>
                      </div>,
                    )
                  }
                  onMouseLeave={hide}
                />
              );
            })}
          </g>
          <text x={labelW} y={height - 2} fontSize={9} fill={AXIS}>
            reps &rarr;
          </text>
        </svg>
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

export function DensityCard({ density, unit }: { density: LoadRepDensity; unit: WeightUnit }) {
  return (
    <ChartCard
      title="Where your sets land"
      subtitle="Effective load against reps. Dense patches are the rep schemes you actually train."
    >
      <DensityHeatmap density={density} unit={unit} />
    </ChartCard>
  );
}
