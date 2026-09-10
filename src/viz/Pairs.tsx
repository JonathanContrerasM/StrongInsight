import { useMemo } from 'react';
import { ChartFrame, HoverLayer } from '../charts/ChartFrame';
import {
  AxisBottom,
  AxisLeft,
  CategoricalLegend,
  NotEnoughData,
  Tooltip,
  useTooltip,
} from '../charts/parts';
import { bandScale, linearScale, timeScale } from '../charts/scale';
import { AXIS, CONTRAST, diverging, PRIMARY } from '../charts/colour';
import { segmentByGap } from '../derive/stats';
import type { LiftRow, SessionPoint, Shape } from '../derive/compare';
import type { CompareScale, WeightUnit } from '../model/types';
import { formatWeight, toDisplayWeight } from '../format';

/**
 * Two people, on one pair of axes.
 *
 * Every chart here is a two-series variant of one that already exists for a
 * single corpus, and every one of them obeys the tab's rule: rates and shares,
 * never totals. A five-year export beats a one-year export on any count, which
 * would make "who trains more" a question about how long someone has owned the
 * app.
 *
 * Colour is fixed across all four -- you are PRIMARY, they are CONTRAST -- so a
 * reader learns the mapping once and carries it down the page.
 */

const YOU = PRIMARY;
const THEM = CONTRAST;

/** Lines break across a gap this long rather than inventing progress through it. */
const MAX_GAP_DAYS = 28;

function legend(youLabel: string, themLabel: string) {
  return [
    { label: youLabel, color: YOU },
    { label: themLabel, color: THEM },
  ];
}

// --- rep distribution ---------------------------------------------------------

/**
 * Grouped rep histogram, plotted as SHARE of working sets.
 *
 * Not two `RepHistogram`s side by side: independent y-scales and independent rep
 * domains would make two pictures that cannot be read against each other, which
 * is worse than no chart. One axis, one scale, both series.
 *
 * Share rather than count for the reason above -- and the shape is the finding
 * anyway. Deliberately not pre-binned into 1-5 / 6-12 / 13+: the multi-modality
 * is what distinguishes two people's programming, and coarse bins erase it.
 */
export function PairedRepBars({
  you,
  them,
  height = 200,
}: {
  you: Shape;
  them: Shape;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();

  const rows = useMemo(() => {
    const youTotal = you.reps.reduce((a, b) => a + b.setCount, 0);
    const themTotal = them.reps.reduce((a, b) => a + b.setCount, 0);
    if (youTotal === 0 || themTotal === 0) return [];

    const youBy = new Map(you.reps.map((b) => [b.reps, b.setCount]));
    const themBy = new Map(them.reps.map((b) => [b.reps, b.setCount]));
    const reps = [...new Set([...youBy.keys(), ...themBy.keys()])].sort((a, b) => a - b);

    return reps.map((r) => ({
      reps: r,
      youCount: youBy.get(r) ?? 0,
      themCount: themBy.get(r) ?? 0,
      youShare: (youBy.get(r) ?? 0) / youTotal,
      themShare: (themBy.get(r) ?? 0) / themTotal,
    }));
  }, [you.reps, them.reps]);

  if (rows.length === 0) {
    return <NotEnoughData need="Both sides need working sets with reps before this compares." />;
  }

  const max = Math.max(...rows.map((r) => Math.max(r.youShare, r.themShare)));

  return (
    <div>
      <ChartFrame height={height} label="Rep distribution, both people">
        {({ innerW, innerH }) => {
          const x = bandScale(rows.length, [0, innerW], 0.25);
          const y = linearScale([0, max], [innerH, 0]);
          const half = x.bandwidth / 2;

          return (
            <>
              <AxisLeft
                scale={y}
                innerW={innerW}
                format={(v) => Math.round(v * 100) + '%'}
              />
              {rows.map((r, i) => (
                <g key={r.reps}>
                  <rect
                    x={x(i)}
                    y={y(r.youShare)}
                    width={half}
                    height={Math.max(0, innerH - y(r.youShare))}
                    fill={YOU}
                  />
                  <rect
                    x={x(i) + half}
                    y={y(r.themShare)}
                    width={half}
                    height={Math.max(0, innerH - y(r.themShare))}
                    fill={THEM}
                  />
                </g>
              ))}
              <AxisBottom
                innerH={innerH}
                ticks={rows
                  .map((r, i) => ({ x: x(i) + half, label: String(r.reps), reps: r.reps }))
                  // Every bar labelled is unreadable past ~24 bins; fall back to
                  // multiples of five, which is where the modes sit anyway.
                  .filter((t) => rows.length <= 24 || t.reps % 5 === 0)}
              />
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(px) => rows[x.indexAt(px)] ?? null}
                onHover={(hit, pos) => {
                  if (!hit || !pos) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div>
                      <div className="font-medium">{hit.reps} reps</div>
                      <div className="num mt-1" style={{ color: YOU }}>
                        {you.label}: {Math.round(hit.youShare * 100)}% ({hit.youCount} sets)
                      </div>
                      <div className="num" style={{ color: THEM }}>
                        {them.label}: {Math.round(hit.themShare * 100)}% ({hit.themCount} sets)
                      </div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-2">
        <CategoricalLegend items={legend(you.label, them.label)} />
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

// --- volume by muscle ---------------------------------------------------------

/**
 * Volume share by muscle, one row per group, both people on the same row.
 *
 * Plain HTML rather than SVG: it is two bars and a percentage, it has to wrap on
 * a phone, and the muscle names are text the browser already knows how to lay
 * out. Shares are normalised to 1 upstream, so this is fair by construction.
 *
 * Caveat worth knowing while reading it: their side runs entirely on GUESSED
 * metadata. Yours can be corrected in the tagging tray; theirs has no such path,
 * because their vocabulary is not yours to curate.
 */
export function PairedMuscleShare({ you, them }: { you: Shape; them: Shape }) {
  const rows = useMemo(() => {
    const youBy = new Map(you.muscleShare.map((m) => [m.group, m.share]));
    const themBy = new Map(them.muscleShare.map((m) => [m.group, m.share]));
    return [...new Set([...youBy.keys(), ...themBy.keys()])]
      .map((group) => ({
        group,
        you: youBy.get(group) ?? 0,
        them: themBy.get(group) ?? 0,
      }))
      .sort((a, b) => Math.max(b.you, b.them) - Math.max(a.you, a.them))
      .slice(0, 8);
  }, [you.muscleShare, them.muscleShare]);

  if (rows.length === 0) {
    return <NotEnoughData need="Neither side has enough tagged exercises to split by muscle." />;
  }

  const max = Math.max(...rows.map((r) => Math.max(r.you, r.them)));

  return (
    <div>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.group} className="grid grid-cols-[5rem_1fr_2.5rem] items-center gap-2 text-xs">
            <span className="truncate text-dim">{r.group}</span>
            <span className="space-y-1">
              <Bar share={r.you} max={max} color={YOU} />
              <Bar share={r.them} max={max} color={THEM} />
            </span>
            <span className="num text-right text-ink">
              {Math.round(r.you * 100)}/{Math.round(r.them * 100)}%
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <CategoricalLegend items={legend(you.label, them.label)} />
      </div>
    </div>
  );
}

function Bar({ share, max, color }: { share: number; max: number; color: string }) {
  return (
    <span className="block h-1.5 overflow-hidden rounded-full bg-sunken">
      <span
        className="block h-full rounded-full"
        style={{ width: (max > 0 ? (share / max) * 100 : 0).toFixed(1) + '%', background: color }}
      />
    </span>
  );
}

// --- strength ratio -----------------------------------------------------------

/**
 * Every shared lift as a bar either side of parity.
 *
 * On a LOG2 axis, which is the whole reason this is a chart rather than a
 * repeat of the table. On a linear ratio axis "twice as strong" (2.0) is four
 * times the bar of "half as strong" (0.5), so the same relationship drawn from
 * the other person's side looks like a different magnitude. Log2 makes 2x and
 * 0.5x mirror images, which is what a reader assumes they are looking at.
 */
export function RatioBars({
  lifts,
  scale,
  youLabel,
  themLabel,
  unit,
}: {
  lifts: LiftRow[];
  scale: CompareScale;
  youLabel: string;
  themLabel: string;
  unit: WeightUnit;
}) {
  const { tip, show, hide } = useTooltip();

  const rows = useMemo(
    () =>
      lifts
        .map((l) => ({ lift: l, ratio: scale === 'relative' ? l.relativeRatio : l.ratio }))
        .filter((r): r is { lift: LiftRow; ratio: number } => r.ratio !== null && r.ratio > 0)
        .sort((a, b) => b.ratio - a.ratio),
    [lifts, scale],
  );

  if (rows.length === 0) {
    return (
      <NotEnoughData
        need={
          scale === 'relative'
            ? 'Per-kg ratios need both bodyweights.'
            : 'No lift cleared every gate, so there is nothing to plot.'
        }
      />
    );
  }

  const logs = rows.map((r) => Math.log2(r.ratio));
  // A symmetric domain, floored so a set of near-parity lifts does not get
  // magnified into a dramatic-looking spread.
  const bound = Math.max(0.25, ...logs.map((v) => Math.abs(v)));
  const height = rows.length * 22 + 36;

  return (
    <div>
      <ChartFrame
        height={height}
        margin={{ left: 148, right: 16, bottom: 24, top: 6 }}
        label="Strength ratio by lift"
      >
        {({ innerW, innerH }) => {
          const x = linearScale([-bound, bound], [0, innerW]);
          const y = bandScale(rows.length, [0, innerH], 0.25);
          const zero = x(0);

          return (
            <>
              {rows.map((r, i) => {
                const v = Math.log2(r.ratio);
                const px = x(v);
                return (
                  <g key={r.lift.name}>
                    <text
                      x={-8}
                      y={y(i) + y.bandwidth / 2}
                      dy="0.32em"
                      textAnchor="end"
                      fontSize={10}
                      fill={AXIS}
                    >
                      {r.lift.name.length > 24 ? r.lift.name.slice(0, 23) + '…' : r.lift.name}
                    </text>
                    <rect
                      x={Math.min(zero, px)}
                      y={y(i)}
                      width={Math.abs(px - zero)}
                      height={y.bandwidth}
                      // Clamped: past 4x in either direction the colour stops
                      // carrying information and only the length should.
                      fill={diverging(Math.min(1, Math.max(0, 0.5 + v / 4)))}
                    />
                  </g>
                );
              })}
              <line y1={0} y2={innerH} x1={zero} x2={zero} stroke={AXIS} />
              <AxisBottom
                innerH={innerH}
                ticks={[0.5, 1, 2]
                  .filter((t) => Math.abs(Math.log2(t)) <= bound)
                  .map((t) => ({ x: x(Math.log2(t)), label: t + '×' }))}
              />
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(_, py) => rows[y.indexAt(py)] ?? null}
                onHover={(hit, pos) => {
                  if (!hit || !pos) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div>
                      <div className="font-medium">{hit.lift.name}</div>
                      <div className="num mt-1" style={{ color: YOU }}>
                        {youLabel}: {formatWeight(hit.lift.youKg, unit)}
                      </div>
                      <div className="num" style={{ color: THEM }}>
                        {themLabel}: {formatWeight(hit.lift.themKg, unit)}
                      </div>
                      <div className="num mt-1 text-dim">
                        {hit.ratio.toFixed(2)}
                        {'×'}
                        {hit.ratio > 1 ? ' to ' + themLabel : hit.ratio < 1 ? ' to ' + youLabel : ''}
                      </div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <p className="mt-2 text-xs text-faint">
        Bars right of parity are lifts {themLabel} is ahead on. The axis is doubling, not linear, so
        2{'×'} and 0.5{'×'} are the same distance from the centre.
      </p>
      <Tooltip state={tip} />
    </div>
  );
}

// --- progression --------------------------------------------------------------

export type ProgressionAlign = 'elapsed' | 'calendar';

/**
 * One lift, both people's session bests over time.
 *
 * `elapsed` is the default alignment and not a convenience: two people's
 * calendars rarely overlap, and on a shared calendar axis someone who started
 * two years earlier is drawn as a long flat line beside a short steep one, which
 * reads as a difference in progress rather than in start date. Elapsed weeks
 * from each person's own first session asks the fairer question.
 *
 * Lines break across a gap rather than crossing it, for the reason
 * `ProgressionChart` gives: a straight line through a four-month layoff is
 * progress that did not happen.
 */
export function PairedProgression({
  lift,
  youLabel,
  themLabel,
  unit,
  align = 'elapsed',
  height = 240,
}: {
  lift: LiftRow;
  youLabel: string;
  themLabel: string;
  unit: WeightUnit;
  align?: ProgressionAlign;
  height?: number;
}) {
  const { tip, show, hide } = useTooltip();

  const series = [
    { label: youLabel, colour: YOU, points: lift.series.you },
    { label: themLabel, colour: THEM, points: lift.series.them },
  ];
  const all = [...lift.series.you, ...lift.series.them];

  if (lift.series.you.length < 2 || lift.series.them.length < 2) {
    return <NotEnoughData need="Both sides need at least two sessions with a usable estimate." />;
  }

  const maxKg = Math.max(...all.map((p) => p.kg));
  const minKg = Math.min(...all.map((p) => p.kg));

  return (
    <div>
      <ChartFrame height={height} corners label={'Progression: ' + lift.name}>
        {({ innerW, innerH }) => {
          const y = linearScale(
            [toDisplayWeight(minKg * 0.92, unit), toDisplayWeight(maxKg * 1.05, unit)],
            [innerH, 0],
          );

          // Calendar: one shared time axis. Elapsed: days since each person's own
          // first session, so the two curves start together.
          const first = new Date(Math.min(...all.map((p) => p.date.getTime())));
          const last = new Date(Math.max(...all.map((p) => p.date.getTime())));
          const t = timeScale([first, last], [0, innerW]);
          const maxDays = Math.max(
            ...series.map((s) => elapsedDays(s.points[s.points.length - 1], s.points[0])),
            1,
          );
          const e = linearScale([0, maxDays], [0, innerW]);

          const px = (s: (typeof series)[number], p: SessionPoint) =>
            align === 'calendar' ? t(p.date) : e(elapsedDays(p, s.points[0]));

          return (
            <>
              <AxisLeft scale={y} innerW={innerW} />
              {series.map((s) => (
                <g key={s.label}>
                  {segmentByGap(s.points, MAX_GAP_DAYS).map((seg, i) => (
                    <path
                      key={i}
                      d={seg.points
                        .map(
                          (p, j) =>
                            (j === 0 ? 'M' : 'L') +
                            px(s, p).toFixed(1) +
                            ',' +
                            y(toDisplayWeight(p.kg, unit)).toFixed(1),
                        )
                        .join(' ')}
                      fill="none"
                      stroke={s.colour}
                      strokeWidth={1.75}
                      strokeLinejoin="round"
                    />
                  ))}
                </g>
              ))}
              <AxisBottom
                innerH={innerH}
                ticks={
                  align === 'calendar'
                    ? [first, last].map((d) => ({
                        x: t(d),
                        label: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'),
                      }))
                    : [0, Math.round(maxDays / 2), Math.round(maxDays)].map((d) => ({
                        x: e(d),
                        label: Math.round(d / 7) + 'w',
                      }))
                }
              />
              <HoverLayer
                width={innerW}
                height={innerH}
                hitTest={(hx) => {
                  // Nearest point on either line, so a sparse series is still
                  // reachable between a dense one's points.
                  let best: { s: string; c: string; p: SessionPoint; d: number } | null = null;
                  for (const s of series) {
                    for (const p of s.points) {
                      const d = Math.abs(px(s, p) - hx);
                      if (!best || d < best.d) best = { s: s.label, c: s.colour, p, d };
                    }
                  }
                  return best && best.d < 24 ? best : null;
                }}
                onHover={(hit, pos) => {
                  if (!hit || !pos) return hide();
                  show(
                    pos.clientX,
                    pos.clientY,
                    <div>
                      <div className="font-medium" style={{ color: hit.c }}>
                        {hit.s}
                      </div>
                      <div className="num mt-1">{formatWeight(hit.p.kg, unit)} est. 1RM</div>
                      <div className="num text-dim">{hit.p.date.toLocaleDateString()}</div>
                    </div>,
                  );
                }}
              />
            </>
          );
        }}
      </ChartFrame>
      <div className="mt-2">
        <CategoricalLegend items={legend(youLabel, themLabel)} />
      </div>
      <Tooltip state={tip} />
    </div>
  );
}

function elapsedDays(p: SessionPoint | undefined, from: SessionPoint | undefined): number {
  if (!p || !from) return 0;
  return (p.date.getTime() - from.date.getTime()) / 86_400_000;
}
