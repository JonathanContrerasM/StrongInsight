import type { RecordBucket, RecordKind } from '../derive/records';
import { ChartFrame, HoverLayer } from '../charts/ChartFrame';
import { AxisBottom, AxisLeft, CategoricalLegend, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { bandScale, linearScale } from '../charts/scale';
import { categorical } from '../charts/colour';
import { formatBucket } from '../derive/buckets';

/** Stack order and colour are fixed per kind, so a bar never reshuffles. */
const KIND_ORDER: RecordKind[] = ['load', 'e1rm', 'reps-at-load'];
export const KIND_LABEL: Record<RecordKind, string> = {
  load: 'heavier load',
  e1rm: 'higher e1RM',
  'reps-at-load': 'more reps at a load',
};
const KIND_COLOUR: Record<RecordKind, string> = {
  load: categorical(0),
  e1rm: categorical(1),
  'reps-at-load': categorical(2),
};

/**
 * Records per month, stacked by kind. Empty months are drawn as empty -- a
 * month with no record is the observation this chart exists to make, and an
 * area or line would interpolate straight across it.
 */
export function RecordsChart({ buckets, height = 180 }: { buckets: RecordBucket[]; height?: number }) {
  const { tip, show, hide } = useTooltip();
  if (buckets.length === 0) return <NotEnoughData need="No records yet -- an exercise's first session sets none." />;

  const max = Math.max(1, ...buckets.map((b) => b.count));
  // One label per quarter-ish, so a three-year chart does not overprint.
  const every = Math.max(1, Math.ceil(buckets.length / 8));

  return (
    <div>
      <ChartFrame height={height} label="Personal records per month">
        {({ innerW, innerH }) => {
          const x = bandScale(buckets.length, [0, innerW], 0.2);
          const y = linearScale([0, max], [innerH, 0]);
          return (
            <>
              <AxisLeft scale={y} innerW={innerW} format={(v) => String(Math.round(v))} />
              {buckets.map((b, i) => {
                let acc = 0;
                return (
                  <g key={b.key}>
                    {KIND_ORDER.map((kind) => {
                      const v = b.byKind[kind];
                      if (v <= 0) return null;
                      const y0 = y(acc);
                      acc += v;
                      const y1 = y(acc);
                      return (
                        <rect
                          key={kind}
                          x={x(i)}
                          y={y1}
                          width={x.bandwidth}
                          height={Math.max(0, y0 - y1 - 1)}
                          fill={KIND_COLOUR[kind]}
                        />
                      );
                    })}
                  </g>
                );
              })}
              <AxisBottom
                innerH={innerH}
                ticks={buckets
                  .map((b, i) => ({ x: x(i) + x.bandwidth / 2, label: formatBucket(b.start, 'month'), i }))
                  .filter((t) => t.i % every === 0)}
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
                  const b = buckets[i];
                  if (!b) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div className="space-y-0.5">
                      <div className="font-medium">{formatBucket(b.start, 'month')}</div>
                      <div className="text-dim">
                        {b.count} {b.count === 1 ? 'record' : 'records'}
                      </div>
                      {KIND_ORDER.filter((k) => b.byKind[k] > 0).map((k) => (
                        <div key={k} className="text-dim">
                          {KIND_LABEL[k]}: {b.byKind[k]}
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
      <div className="mt-1">
        <CategoricalLegend
          items={KIND_ORDER.map((k) => ({ label: KIND_LABEL[k], color: KIND_COLOUR[k] }))}
        />
      </div>
      <Tooltip state={tip} />
    </div>
  );
}
