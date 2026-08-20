/**
 * Minimal scale primitives. Pure, no React, no domain knowledge.
 *
 * This layer must never import from model/ or derive/: if a scale needs to know
 * what a Muscle is, it is in the wrong place.
 */

export type LinearScale = {
  (value: number): number;
  invert(px: number): number;
  domain: [number, number];
  range: [number, number];
};

export function linearScale(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;

  const fn = ((value: number): number => {
    // A degenerate domain must not divide by zero -- centre it instead.
    if (span === 0) return (r0 + r1) / 2;
    return r0 + ((value - d0) / span) * (r1 - r0);
  }) as LinearScale;

  fn.invert = (px: number) => {
    const rSpan = r1 - r0;
    if (rSpan === 0) return d0;
    return d0 + ((px - r0) / rSpan) * span;
  };
  fn.domain = domain;
  fn.range = range;
  return fn;
}

export type BandScale = {
  (index: number): number;
  bandwidth: number;
  step: number;
  count: number;
  /** Index whose band contains px, or -1. */
  indexAt(px: number): number;
};

export function bandScale(count: number, range: [number, number], padding = 0.1): BandScale {
  const [r0, r1] = range;
  const total = r1 - r0;
  const step = count <= 0 ? 0 : total / count;
  const bandwidth = Math.max(0, step * (1 - padding));

  const fn = ((index: number): number => r0 + step * index + (step - bandwidth) / 2) as BandScale;
  fn.bandwidth = bandwidth;
  fn.step = step;
  fn.count = count;
  fn.indexAt = (px: number) => {
    if (step === 0) return -1;
    const i = Math.floor((px - r0) / step);
    return i < 0 || i >= count ? -1 : i;
  };
  return fn;
}

/** Square-root scale: for counts, where linear buries the singletons. */
export function sqrtScale(domain: [number, number], range: [number, number]) {
  const [d0, d1] = domain;
  const s0 = Math.sqrt(Math.max(0, d0));
  const s1 = Math.sqrt(Math.max(0, d1));
  const inner = linearScale([s0, s1], range);
  return (value: number) => inner(Math.sqrt(Math.max(0, value)));
}

export type TimeScale = {
  (d: Date): number;
  invert(px: number): Date;
  domain: [Date, Date];
};

export function timeScale(domain: [Date, Date], range: [number, number]): TimeScale {
  const inner = linearScale([domain[0].getTime(), domain[1].getTime()], range);
  const fn = ((d: Date) => inner(d.getTime())) as TimeScale;
  fn.invert = (px: number) => new Date(inner.invert(px));
  fn.domain = domain;
  return fn;
}
