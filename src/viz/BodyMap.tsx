import type { ReactNode } from 'react';
import { BODY, BODY_STROKE, FATIGUE, INK } from '../charts/colour';
import { Tooltip, useTooltip } from '../charts/parts';
import BODY_PATHS, { type Figure, type Side } from './bodyPaths';

/**
 * Front and back body outlines with each region filled by a level 0..4.
 *
 * No domain knowledge: the caller says which regions are coloured, at what
 * level, with what tooltip. Regions it does not mention are drawn as silhouette
 * and are not interactive.
 *
 * This module pulls in the ~90 KB of path data, so views load it lazily.
 */

export type BodyRegion = {
  level: number;
  /** Accessible name and tooltip heading. */
  label: string;
  tip: ReactNode;
};

const SIDES: Side[] = ['front', 'back'];

export function BodyMap({
  figure,
  regions,
  selected,
  onSelect,
}: {
  figure: Figure;
  regions: ReadonlyMap<string, BodyRegion>;
  /** Highlighted with an outline. */
  selected?: string | null;
  onSelect?: (region: string | null) => void;
}) {
  const { tip, show, hide } = useTooltip();

  return (
    <div className="grid grid-cols-2 gap-2 sm:gap-6">
      {SIDES.map((side) => {
        const view = BODY_PATHS[figure][side];
        return (
          <figure key={side} className="mx-auto w-full max-w-[15rem]">
            <svg
              viewBox={view.viewBox}
              className="h-auto w-full"
              role="group"
              aria-label={side === 'front' ? 'Body, front' : 'Body, back'}
            >
              {Object.entries(view.paths).map(([id, paths]) => {
                const r = regions.get(id);
                const fill = r ? (FATIGUE[Math.max(0, Math.min(4, r.level))] ?? BODY) : BODY;
                const isSelected = r !== undefined && selected === id;
                return (
                  <g
                    key={id}
                    fill={fill}
                    stroke={isSelected ? INK : BODY_STROKE}
                    strokeWidth={isSelected ? 6 : 2.5}
                    strokeLinejoin="round"
                    {...(r
                      ? {
                          role: 'button',
                          tabIndex: 0,
                          'aria-label': r.label,
                          'aria-pressed': isSelected,
                          className: 'cursor-pointer outline-none',
                          onPointerMove: (e: React.PointerEvent) => show(e.clientX, e.clientY, r.tip),
                          onPointerLeave: hide,
                          onClick: () => onSelect?.(isSelected ? null : id),
                          onKeyDown: (e: React.KeyboardEvent) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onSelect?.(isSelected ? null : id);
                            }
                          },
                        }
                      : { 'aria-hidden': true })}
                  >
                    {paths?.map((d, i) => <path key={i} d={d} />)}
                  </g>
                );
              })}
            </svg>
            <figcaption className="hud-label mt-1 text-center">{side}</figcaption>
          </figure>
        );
      })}
      <Tooltip state={tip} />
    </div>
  );
}

export default BodyMap;
