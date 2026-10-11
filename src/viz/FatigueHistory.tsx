import { AXIS_TEXT, BODY, FATIGUE, INK, INK_DIM } from '../charts/colour';
import { NotEnoughData, Tooltip, useTooltip } from '../charts/parts';
import { fatigueLevelOf, fatigueStateOf, type FatigueHistory } from '../derive/recovery';
import { formatDate } from '../format';
import { MUSCLE_LABEL } from './bodyRegions';

/**
 * Muscle by day, each cell the fatigue at the end of that day, on the same five
 * steps as the body map. A dot marks a training day; a ring marks a session that
 * started while the muscle was still fatigued.
 *
 * The rhythm is the point: a healthy split reads as regular stripes that fade
 * back to grey before the next dot. Rings say the next session came too soon.
 */

const CELL = 14;
const ROW = 16;
const LABEL_W = 92;
const AXIS_H = 18;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function FatigueHistoryChart({ history }: { history: FatigueHistory }) {
  const { tip, show, hide } = useTooltip();
  if (history.rows.length === 0) return <NotEnoughData need="Nothing trained in this window." />;

  const width = LABEL_W + history.days.length * CELL;
  const height = history.rows.length * ROW + AXIS_H;
  const lastIdx = history.days.length - 1;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} role="img" aria-label="Fatigue per muscle per day">
        {history.rows.map((row, ri) => {
          const y = ri * ROW;
          return (
            <g key={row.muscle}>
              <text x={LABEL_W - 6} y={y + ROW / 2} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT}>
                {MUSCLE_LABEL[row.muscle]}
              </text>
              {row.values.map((v, di) => {
                const x = LABEL_W + di * CELL;
                const level = fatigueLevelOf(v);
                const day = history.days[di]!;
                return (
                  <g
                    key={di}
                    onPointerMove={(e) =>
                      show(
                        e.clientX,
                        e.clientY,
                        <div className="space-y-0.5">
                          <div className="font-semibold">
                            {MUSCLE_LABEL[row.muscle]}, {formatDate(day)}
                          </div>
                          <div className="text-dim">
                            {Math.round(v * 100)}% {di === lastIdx ? 'now' : 'at the end of the day'} ({fatigueStateOf(v)})
                          </div>
                          {row.overreached[di] ? (
                            <div className="text-danger">Trained while still fatigued</div>
                          ) : row.trained[di] ? (
                            <div className="text-faint">Trained</div>
                          ) : null}
                        </div>,
                      )
                    }
                    onPointerLeave={hide}
                  >
                    <rect
                      x={x + 1}
                      y={y + 1}
                      width={CELL - 2}
                      height={ROW - 2}
                      rx={2}
                      fill={level === 0 ? BODY : FATIGUE[level]}
                    />
                    {row.trained[di] && (
                      <circle cx={x + CELL / 2} cy={y + ROW / 2} r={2} fill={row.overreached[di] ? INK : INK_DIM} />
                    )}
                    {row.overreached[di] && (
                      <circle
                        cx={x + CELL / 2}
                        cy={y + ROW / 2}
                        r={5}
                        fill="none"
                        stroke={INK}
                        strokeWidth={1.5}
                      />
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
        {history.days.map((d, di) =>
          // A tick every Monday-or-whatever: every 7th day counting back from today.
          (lastIdx - di) % 7 === 0 ? (
            <text
              key={di}
              x={LABEL_W + di * CELL + CELL / 2}
              y={history.rows.length * ROW + 12}
              textAnchor="middle"
              fontSize={9}
              fill={AXIS_TEXT}
              className="num"
            >
              {d.getDate() + ' ' + MONTHS[d.getMonth()]}
            </text>
          ) : null,
        )}
      </svg>
      <Tooltip state={tip} />
    </div>
  );
}
