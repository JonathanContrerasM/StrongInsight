import type { RepBin, SetPositionProfile } from '../derive/profile';
import { ChartFrame, HoverLayer } from '../charts/ChartFrame';
import { AxisLeft, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { bandScale, linearScale } from '../charts/scale';
import { formatWeight, toDisplayWeight } from '../format';
import type { WeightUnit } from '../model/types';

/**
 * Rep histogram, one bar per integer rep.
 *
 * Deliberately NOT pre-binned into 1-5 / 6-12 / 13+: the multi-modality is the
 * finding. This corpus spikes hard at 10, 8, 12 and 20 with a separate 3-6
 * strength cluster, and any coarse binning erases exactly that structure.
 */
export function RepHistogram({ bins, height = 180 }: { bins: RepBin[]; height?: number }) {
  const { tip, show, hide } = useTooltip();
  if (bins.length === 0) return <NotEnoughData need="No working sets with reps yet." />;

  const max = Math.max(...bins.map((b) => b.setCount));

  return (
    <div>
      <ChartFrame height={height} label="Rep distribution">
        {({ innerW, innerH }) => {
          const x = bandScale(bins.length, [0, innerW], 0.2);
          const y = linearScale([0, max], [innerH, 0]);
          return (
            <>
              <AxisLeft scale={y} innerW={innerW} />
              {bins.map((b, i) => (
                <g key={b.reps}>
                  <rect
                    x={x(i)}
                    y={y(b.setCount)}
                    width={x.bandwidth}
                    height={Math.max(0, innerH - y(b.setCount))}
                    fill="#3b82f6"
                  />
                  {(bins.length <= 24 || b.reps % 5 === 0) && (
                    <text
                      x={x(i) + x.bandwidth / 2}
                      y={innerH + 12}
                      fontSize={9}
                      textAnchor="middle"
                      fill="#94a3b8"
                    >
                      {b.reps}
                    </text>
                  )}
                </g>
              ))}
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  const i = x.indexAt(px);
                  return i < 0 ? null : i;
                }}
                onHover={(i, pos) => {
                  if (i === null || !pos) return hide();
                  const b = bins[i];
                  if (!b) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div>
                      <div className="font-medium">{b.reps} reps</div>
                      <div className="text-slate-600">{b.setCount} sets</div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <p className="mt-1 text-xs text-slate-500">One bar per rep count, not grouped into zones.</p>
      <Tooltip state={tip} />
    </div>
  );
}

const SHAPE_COPY: Record<SetPositionProfile['shape'], string> = {
  ramping:
    'Load rises across your sets: you ramp up within the exercise rather than doing straight sets. Falling reps here are not fatigue.',
  fatiguing: 'Load stays flat while reps fall: this is genuine within-exercise fatigue.',
  straight: 'Load and reps both hold roughly steady: straight sets.',
  'insufficient-data': 'Not enough sets at each position to characterise the shape.',
};

/**
 * Mean reps AND mean load by set position.
 *
 * Plotting reps alone would be actively misleading. The obvious chart to build is
 * a "fatigue curve", but in this corpus load RISES across set positions (Squat
 * runs 14 -> 36 -> 60 -> 73 -> 81 kg) because the athlete ramps up within their
 * numbered sets. Only when load is pinned -- bodyweight work -- does falling reps
 * actually mean fatigue. Showing both series makes the difference visible.
 */
export function SetPositionChart({
  profile,
  unit,
  height = 200,
}: {
  profile: SetPositionProfile;
  unit: WeightUnit;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();
  const pts = profile.points;
  if (pts.length < 2) return <NotEnoughData need="Needs sets at 2 or more positions." />;

  const maxReps = Math.max(...pts.map((p) => p.meanReps ?? 0), 1);
  const maxLoad = Math.max(...pts.map((p) => p.meanLoadKg ?? 0), 0);

  return (
    <div>
      <ChartFrame height={height} label="Set position profile" margin={{ right: 44 }}>
        {({ innerW, innerH }) => {
          const x = bandScale(pts.length, [0, innerW], 0.25);
          const yReps = linearScale([0, maxReps * 1.15], [innerH, 0]);
          const yLoad = linearScale([0, Math.max(1, maxLoad) * 1.15], [innerH, 0]);

          let pen = false;
          const loadPath = pts
            .map((p, i) => {
              if (p.meanLoadKg === null) {
                pen = false;
                return '';
              }
              const cmd = pen ? 'L' : 'M';
              pen = true;
              return (
                cmd +
                (x(i) + x.bandwidth / 2).toFixed(1) +
                ',' +
                yLoad(toDisplayWeight(p.meanLoadKg, unit)).toFixed(1) +
                ' '
              );
            })
            .join('');

          return (
            <>
              <AxisLeft scale={yReps} innerW={innerW} />
              {pts.map((p, i) => (
                <g key={p.setOrder}>
                  <rect
                    x={x(i)}
                    y={yReps(p.meanReps ?? 0)}
                    width={x.bandwidth}
                    height={Math.max(0, innerH - yReps(p.meanReps ?? 0))}
                    fill="#bfdbfe"
                  />
                  <text
                    x={x(i) + x.bandwidth / 2}
                    y={innerH + 12}
                    fontSize={9}
                    textAnchor="middle"
                    fill="#94a3b8"
                  >
                    {p.setOrder}
                  </text>
                </g>
              ))}
              {maxLoad > 0 && (
                <>
                  <path d={loadPath} fill="none" stroke="#ea580c" strokeWidth={2} />
                  {pts.map((p, i) =>
                    p.meanLoadKg === null ? null : (
                      <circle
                        key={p.setOrder}
                        cx={x(i) + x.bandwidth / 2}
                        cy={yLoad(toDisplayWeight(p.meanLoadKg, unit))}
                        r={3}
                        fill="#ea580c"
                      />
                    ),
                  )}
                </>
              )}
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => {
                  const i = x.indexAt(px);
                  return i < 0 ? null : i;
                }}
                onHover={(i, pos) => {
                  if (i === null || !pos) return hide();
                  const p = pts[i];
                  if (!p) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">Set {p.setOrder}</div>
                      <div className="text-slate-600">
                        {p.meanReps === null ? 'no reps' : p.meanReps.toFixed(1) + ' reps average'}
                      </div>
                      <div className="text-slate-600">
                        {p.meanLoadKg === null
                          ? 'no resolvable load'
                          : formatWeight(p.meanLoadKg, unit, 1) + ' average'}
                      </div>
                      <div className="text-slate-500">{p.setCount} sets</div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-blue-200" /> mean reps
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-0.5 w-4" style={{ background: '#ea580c' }} /> mean load
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-500">{SHAPE_COPY[profile.shape]}</p>
      <Tooltip state={tip} />
    </div>
  );
}
