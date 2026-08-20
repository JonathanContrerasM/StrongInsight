import { useCallback, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { niceTicks } from '../derive/stats';
import type { LinearScale } from './scale';

/** Axes, legends, tooltip and the shared empty state. */

const AXIS_INK = '#94a3b8';
const AXIS_TEXT = '#64748b';

export function AxisLeft({
  scale,
  innerW,
  tickCount = 5,
  format = (v: number) => String(Math.round(v)),
}: {
  scale: LinearScale;
  innerW: number;
  tickCount?: number;
  format?: (v: number) => string;
}) {
  const [d0, d1] = scale.domain;
  const ticks = niceTicks(Math.min(d0, d1), Math.max(d0, d1), tickCount);
  return (
    <g>
      {ticks.map((t) => {
        const y = scale(t);
        return (
          <g key={t} transform={'translate(0,' + y + ')'}>
            <line x1={0} x2={innerW} stroke={AXIS_INK} strokeOpacity={0.25} />
            <text x={-8} dy="0.32em" textAnchor="end" fontSize={10} fill={AXIS_TEXT} className="tabular-nums">
              {format(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export function AxisBottom({
  ticks,
  innerH,
}: {
  ticks: Array<{ x: number; label: string }>;
  innerH: number;
}) {
  return (
    <g transform={'translate(0,' + innerH + ')'}>
      <line x1={0} x2={0} stroke={AXIS_INK} />
      {ticks.map((t, i) => (
        <text
          key={i}
          x={t.x}
          y={14}
          textAnchor="middle"
          fontSize={10}
          fill={AXIS_TEXT}
          className="tabular-nums"
        >
          {t.label}
        </text>
      ))}
    </g>
  );
}

// --- tooltip ------------------------------------------------------------------

export type TooltipState = { x: number; y: number; content: ReactNode } | null;

export function useTooltip() {
  const [tip, setTip] = useState<TooltipState>(null);
  const show = useCallback((x: number, y: number, content: ReactNode) => setTip({ x, y, content }), []);
  const hide = useCallback(() => setTip(null), []);
  return { tip, show, hide };
}

/**
 * Rendered as HTML in a portal rather than as SVG text: it lets the tooltip reuse
 * Tailwind, wrap long exercise names, and carry the same "unverified" badge
 * markup the rest of the app uses.
 */
/**
 * NOTE: this is `position: fixed`, so `state.x`/`state.y` MUST be viewport
 * coordinates (`clientX`/`clientY`). Passing plot-local coordinates puts the
 * tooltip at a fixed offset from the window corner instead of at the cursor --
 * an error that grows the further down the page the chart sits.
 */
export function Tooltip({ state }: { state: TooltipState }) {
  if (!state || typeof document === 'undefined') return null;
  const PAD = 14;
  // Flip rather than clamp, on both axes: anchoring the opposite edge keeps the
  // tooltip on screen without needing to guess its width or height.
  const flipX = state.x > window.innerWidth - 260;
  const flipY = state.y > window.innerHeight - 160;
  return createPortal(
    <div
      className="pointer-events-none fixed z-50 max-w-xs rounded border border-slate-300 bg-white px-2 py-1.5 text-xs shadow-lg"
      style={{
        left: flipX ? undefined : state.x + PAD,
        right: flipX ? window.innerWidth - state.x + PAD : undefined,
        top: flipY ? undefined : state.y + PAD,
        bottom: flipY ? window.innerHeight - state.y + PAD : undefined,
      }}
    >
      {state.content}
    </div>,
    document.body,
  );
}

// --- legends ------------------------------------------------------------------

export function CategoricalLegend({
  items,
}: {
  items: Array<{ label: string; color: string; muted?: boolean }>;
}) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: it.color, opacity: it.muted ? 0.55 : 1 }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Colour bar for a binned scale. Always prints the real values: with quantile
 * bins a shade means "busy relative to your own history", and hiding the numbers
 * would invite reading absolute meaning into a colour.
 */
export function BinLegend({
  ranges,
  colors,
  format,
  lowLabel = 'less',
  highLabel = 'more',
}: {
  ranges: Array<[number, number]>;
  colors: string[];
  format: (v: number) => string;
  lowLabel?: string;
  highLabel?: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500">
      <span>{lowLabel}</span>
      {colors.map((c, i) => (
        <span
          key={i}
          className="inline-block h-3 w-4 rounded-sm border border-slate-200"
          style={{ background: c }}
          title={ranges[i] ? format(ranges[i]![0]) + ' - ' + format(ranges[i]![1]) : undefined}
        />
      ))}
      <span>{highLabel}</span>
    </div>
  );
}

// --- shared states ------------------------------------------------------------

/** Never render an empty chart frame: say what is missing and how much is needed. */
export function NotEnoughData({ need }: { need: string }) {
  return (
    <div className="flex h-full min-h-24 items-center justify-center rounded border border-dashed border-slate-200 p-4 text-center text-sm text-slate-500">
      {need}
    </div>
  );
}

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  note,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  note?: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </header>
      {children}
      {note && <p className="mt-2 text-xs text-slate-500">{note}</p>}
    </section>
  );
}

/**
 * The promise from iteration 1: an unconfirmed tag is visible wherever it
 * affects what is shown. Charts that group by metadata carry this chip.
 */
export function UnverifiedChip({
  unconfirmed,
  total,
  onClick,
}: {
  unconfirmed: number;
  total: number;
  onClick?: () => void;
}) {
  if (unconfirmed === 0 || total === 0) return null;
  const pct = Math.round((unconfirmed / total) * 100);
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900 hover:bg-amber-200"
      title="These groupings rely on exercise tags that are still heuristic guesses"
    >
      {pct}% unverified tags
    </button>
  );
}

export function Toggle<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-300">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={
            'px-2 py-1 text-xs font-medium ' +
            (o.value === value ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
