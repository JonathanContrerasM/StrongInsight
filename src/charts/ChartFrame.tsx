import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

/**
 * Responsive SVG frame using the standard margin convention.
 * Measures its container and hands the inner plot size to a render prop.
 */

export type Margin = { top: number; right: number; bottom: number; left: number };

export const DEFAULT_MARGIN: Margin = { top: 8, right: 12, bottom: 28, left: 44 };

export function useMeasuredWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // ResizeObserver rather than a window listener: the container can change
    // size without the window doing so (tab switches, sidebars, details toggles).
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  return [ref, width];
}

export type ChartFrameProps = {
  height: number;
  margin?: Partial<Margin>;
  label: string;
  className?: string;
  children: (dims: { innerW: number; innerH: number; margin: Margin; width: number }) => ReactNode;
};

export function ChartFrame({ height, margin, label, className, children }: ChartFrameProps) {
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  const m = useMemo<Margin>(() => ({ ...DEFAULT_MARGIN, ...margin }), [margin]);

  const innerW = Math.max(0, width - m.left - m.right);
  const innerH = Math.max(0, height - m.top - m.bottom);

  return (
    <div ref={ref} className={className}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={label}>
          <g transform={'translate(' + m.left + ',' + m.top + ')'}>
            {children({ innerW, innerH, margin: m, width })}
          </g>
        </svg>
      )}
    </div>
  );
}

/**
 * A single transparent hit-testing surface.
 *
 * One rAF-throttled pointermove beats attaching handlers to thousands of rects:
 * the heatmaps here reach ~2,000 cells, and per-mark listeners would mean as
 * many event closures plus dead zones between marks.
 */
/**
 * Two coordinate spaces, and mixing them up is a real bug that has bitten before:
 *
 *  - `x`/`y` are PLOT-LOCAL, relative to the hover rect. Hit-testing wants these,
 *    because scales are defined in plot space.
 *  - `clientX`/`clientY` are VIEWPORT coordinates. Anything positioned with
 *    `position: fixed` -- notably the tooltip -- must use these, or it lands at a
 *    constant offset from the window origin instead of following the cursor.
 */
export type HoverPos = { x: number; y: number; clientX: number; clientY: number };

export function HoverLayer<T>({
  width,
  height,
  hitTest,
  onHover,
  onSelect,
}: {
  width: number;
  height: number;
  hitTest: (x: number, y: number) => T | null;
  onHover: (hit: T | null, pos: HoverPos | null) => void;
  onSelect?: (hit: T) => void;
}) {
  const frame = useRef<number | null>(null);
  const pending = useRef<HoverPos | null>(null);

  const flush = useCallback(() => {
    frame.current = null;
    const p = pending.current;
    if (!p) return;
    // Hit-test in plot space; hand the caller both spaces.
    onHover(hitTest(p.x, p.y), p);
  }, [hitTest, onHover]);

  const handleMove = useCallback(
    (e: React.PointerEvent<SVGRectElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      pending.current = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        clientX: e.clientX,
        clientY: e.clientY,
      };
      if (frame.current === null) frame.current = requestAnimationFrame(flush);
    },
    [flush],
  );

  useEffect(() => {
    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (
    <rect
      width={Math.max(0, width)}
      height={Math.max(0, height)}
      fill="transparent"
      style={{ cursor: onSelect ? 'pointer' : 'default' }}
      onPointerMove={handleMove}
      onPointerLeave={() => {
        pending.current = null;
        onHover(null, null);
      }}
      onClick={(e) => {
        if (!onSelect) return;
        const rect = e.currentTarget.getBoundingClientRect();
        const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
        if (hit !== null) onSelect(hit);
      }}
    />
  );
}
