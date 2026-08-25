import { useMemo, useState } from 'react';
import type { CooccurrenceResult } from '../derive/cooccurrence';
import { categorical, sequential, NEUTRAL_INK, INK, INK_DIM, MUTED } from '../charts/colour';
import { ChartCard, NotEnoughData, Tooltip, useTooltip } from '../charts/parts';

/**
 * The recovered training split.
 *
 * Strong labels every session with a time-of-day name, so the routine is invisible
 * in the raw data. This matrix shows which exercises are actually trained together
 * and the block structure that falls out of clustering them.
 */

const MAX_RENDERED = 60;

export function SplitMatrix({
  result,
  onSelectExercise,
}: {
  result: CooccurrenceResult;
  onSelectExercise?: (name: string) => void;
}) {
  const { tip, show, hide } = useTooltip();
  const [hover, setHover] = useState<{ i: number; j: number } | null>(null);

  // A 130x130 grid is both slow and unreadable; cap and say what was cut.
  const shown = Math.min(result.order.length, MAX_RENDERED);
  const cropped = result.order.length - shown;

  const clusterOfIndex = useMemo(() => {
    const map = new Map<string, number>();
    result.clusters.forEach((c, ci) => c.members.forEach((m) => map.set(m, ci)));
    return result.order.slice(0, shown).map((n) => map.get(n) ?? -1);
  }, [result, shown]);

  if (result.order.length < 2) {
    return (
      <NotEnoughData
        need={
          'Not enough repeated exercises to detect a split yet. ' +
          result.tooRare.length +
          ' exercises appear in fewer than ' +
          result.minAppearancesUsed +
          ' sessions.'
        }
      />
    );
  }

  const cell = shown > 40 ? 9 : shown > 25 ? 13 : 18;
  const labelW = 150;
  const size = shown * cell;

  return (
    <div className="space-y-3">
      {!result.wellSeparated && (
        <p className="rounded border border-warn-line bg-warn-bg p-2 text-xs text-warn">
          These groups are <strong>not well separated</strong> (silhouette{' '}
          {result.silhouette.toFixed(2)}). Your sessions do not repeat consistent exercise groupings,
          so treat the blocks below as weak structure rather than a routine.
        </p>
      )}

      <div className="overflow-x-auto">
        <svg
          width={labelW + size + 8}
          height={size + 24}
          role="img"
          aria-label="Exercise co-occurrence matrix"
          onMouseLeave={() => {
            setHover(null);
            hide();
          }}
        >
          {result.order.slice(0, shown).map((name, i) => (
            <text
              key={name}
              x={labelW - 6}
              y={i * cell + cell / 2 + 20}
              textAnchor="end"
              dy="0.32em"
              fontSize={Math.min(10, cell)}
              fill={hover && hover.i === i ? INK : INK_DIM}
              fontWeight={hover && hover.i === i ? 600 : 400}
              style={{ cursor: onSelectExercise ? 'pointer' : 'default' }}
              onClick={() => onSelectExercise?.(name)}
            >
              {name.length > 24 ? name.slice(0, 23) + '…' : name}
            </text>
          ))}

          <g transform={'translate(' + labelW + ',20)'}>
            {result.order.slice(0, shown).map((_, i) =>
              result.order.slice(0, shown).map((_, j) => {
                const v = result.similarity[i]?.[j] ?? 0;
                const isDiag = i === j;
                const highlighted = hover && (hover.i === i || hover.j === j);
                return (
                  <rect
                    key={i + '-' + j}
                    x={j * cell}
                    y={i * cell}
                    width={cell - 1}
                    height={cell - 1}
                    rx={1}
                    // The diagonal is always 1 and meaningless as similarity;
                    // render it muted so it does not dominate the grid.
                    fill={isDiag ? MUTED : sequential(0.06 + v * 0.94)}
                    opacity={highlighted || !hover ? 1 : 0.45}
                    onMouseEnter={(e) => {
                      setHover({ i, j });
                      show(e.clientX, e.clientY, <MatrixTip result={result} i={i} j={j} />);
                    }}
                  />
                );
              }),
            )}

            {/* Cluster block outlines over the diagonal. */}
            {blockRanges(clusterOfIndex).map((b) => (
              <rect
                key={b.start}
                x={b.start * cell - 1}
                y={b.start * cell - 1}
                width={(b.end - b.start + 1) * cell}
                height={(b.end - b.start + 1) * cell}
                fill="none"
                stroke={b.cluster >= 0 ? categorical(b.cluster) : NEUTRAL_INK}
                strokeWidth={1.5}
                rx={2}
              />
            ))}
          </g>
        </svg>
      </div>

      <p className="text-xs text-dim">
        Colour is cosine similarity: how often two exercises share a session, normalised so a
        frequent staple does not look similar to everything. Boxes are the detected groups.
        {cropped > 0 && ' Showing the ' + shown + ' most-trained of ' + result.order.length + '.'}
      </p>
      <Tooltip state={tip} />
    </div>
  );
}

function blockRanges(clusterOfIndex: number[]): Array<{ start: number; end: number; cluster: number }> {
  const out: Array<{ start: number; end: number; cluster: number }> = [];
  let start = 0;
  for (let i = 1; i <= clusterOfIndex.length; i++) {
    if (i === clusterOfIndex.length || clusterOfIndex[i] !== clusterOfIndex[start]) {
      // Single-cell boxes add noise without adding information.
      if (i - start > 1) out.push({ start, end: i - 1, cluster: clusterOfIndex[start] ?? -1 });
      start = i;
    }
  }
  return out;
}

function MatrixTip({ result, i, j }: { result: CooccurrenceResult; i: number; j: number }) {
  const a = result.order[i] ?? '';
  const b = result.order[j] ?? '';
  const shared = result.counts[i]?.[j] ?? 0;
  const sim = result.similarity[i]?.[j] ?? 0;
  const aN = result.appearances[i] ?? 0;
  const bN = result.appearances[j] ?? 0;

  if (i === j) {
    return (
      <div>
        <div className="font-medium">{a}</div>
        <div className="text-dim">Appears in {aN} sessions</div>
      </div>
    );
  }

  // Lift: how much more often than chance. Suppressed on thin evidence, where
  // a couple of coincidences produce a spectacular and meaningless number.
  const expected = (aN * bN) / Math.max(1, result.totalWorkouts);
  const lift = expected > 0 ? shared / expected : 0;

  return (
    <div className="space-y-0.5">
      <div className="font-medium">
        {a} + {b}
      </div>
      <div className="text-dim">
        {shared} shared sessions (of {aN} and {bN})
      </div>
      <div className="text-dim">similarity {sim.toFixed(2)}</div>
      {shared >= 5 && (
        <div className="text-dim">
          {lift >= 1.15
            ? lift.toFixed(1) + '× more often than chance'
            : lift <= 0.85
              ? 'less often than chance'
              : 'about as often as chance'}
        </div>
      )}
    </div>
  );
}

export function SplitPanel({
  result,
  onSelectExercise,
}: {
  result: CooccurrenceResult;
  onSelectExercise?: (name: string) => void;
}) {
  const [showRare, setShowRare] = useState(false);

  return (
    <ChartCard
      title="Your recovered training split"
      subtitle={
        <>
          Strong labels every session by time of day, so your routine is invisible in the raw
          export. This groups exercises by which sessions they share.{' '}
          <span className="text-faint">
            Grouping uses no metadata at all; only the group names do.
          </span>
        </>
      }
    >
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <SplitMatrix result={result} onSelectExercise={onSelectExercise} />

        <div className="space-y-2">
          {result.clusters.map((c, i) => (
            <div key={c.label + i} className="rounded border border-line p-2">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-sm"
                    style={{ background: categorical(i) }}
                  />
                  {c.label}
                </span>
                <span className="text-xs text-dim tabular-nums">
                  {c.members.length} exercises
                </span>
              </div>
              <div className="mt-1 text-xs text-dim">
                trained in {c.workoutCount} sessions &middot; cohesion {c.cohesion.toFixed(2)}
              </div>
              <div className="mt-1 text-xs text-dim">
                {c.members.slice(0, 6).join(', ')}
                {c.members.length > 6 && ' +' + (c.members.length - 6) + ' more'}
              </div>
            </div>
          ))}

          <div className="rounded border border-line p-2 text-xs text-dim">
            <div>
              Separation score {result.silhouette.toFixed(2)}{' '}
              {result.wellSeparated ? '(clear structure)' : '(weak structure)'}
            </div>
            <div className="mt-1">
              Threshold chosen automatically: exercises need {result.minAppearancesUsed}+ sessions.
            </div>
            {result.tooRare.length > 0 && (
              <button
                type="button"
                onClick={() => setShowRare((v) => !v)}
                className="mt-1 underline hover:text-ink"
              >
                {result.tooRare.length} exercises too rare to place
              </button>
            )}
            {showRare && (
              <ul className="mt-1 max-h-40 overflow-y-auto">
                {result.tooRare.map((t) => (
                  <li key={t.name}>
                    {t.name} <span className="text-faint">({t.appearances})</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </ChartCard>
  );
}
