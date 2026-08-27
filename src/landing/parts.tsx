import type { ReactNode } from 'react';
import { LinkButton } from '../ui/primitives';

/**
 * Building blocks used only by the landing page.
 *
 * Anything generic enough to be wanted twice lives in `ui/primitives.tsx`
 * instead -- these four are shaped by the marketing page specifically and would
 * be dead weight in the app.
 *
 * The colour rule is the app's rule: semantic tokens only. No hex, no
 * `slate-*`, no `dark:` variants -- the tokens swap themselves.
 */

/** Where the app lives now that `/` is the landing page. */
export const APP = '/app.html';

/**
 * A screenshot in a browser-ish frame, with a light and a dark capture swapped
 * by the theme class.
 *
 * Both images ship in the markup rather than being chosen in JavaScript: the
 * theme class is stamped on <html> before first paint, so CSS can do the swap
 * with no hydration flicker and no state. `width`/`height` are required -- an
 * unsized 1600px-wide image reflows the whole page when it lands.
 */
export function Shot({
  src,
  darkSrc,
  alt,
  width,
  height,
  className = '',
  priority = false,
}: {
  src: string;
  darkSrc: string;
  alt: string;
  width: number;
  height: number;
  className?: string;
  /** The hero shot is above the fold, so it must not be lazy. */
  priority?: boolean;
}) {
  const img = 'block h-auto w-full';
  const common = {
    alt,
    width,
    height,
    loading: priority ? ('eager' as const) : ('lazy' as const),
    decoding: 'async' as const,
  };
  return (
    <figure
      className={
        'overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--c-shadow)] ' +
        className
      }
    >
      {/* A title bar, so a flat screenshot reads as a window rather than a diagram. */}
      <div className="flex items-center gap-1.5 border-b border-line bg-sunken px-3 py-2">
        <span aria-hidden className="h-2 w-2 rounded-full bg-line-strong" />
        <span aria-hidden className="h-2 w-2 rounded-full bg-line-strong" />
        <span aria-hidden className="h-2 w-2 rounded-full bg-line-strong" />
        <span className="hud-label ml-2 truncate">{alt}</span>
      </div>
      <img src={src} className={img + ' dark:hidden'} {...common} />
      <img src={darkSrc} className={img + ' hidden dark:block'} {...common} />
    </figure>
  );
}

/**
 * One tour entry: a screenshot on one side, the pitch and a link into the app on
 * the other. `flip` alternates the sides down the page.
 */
export function FeatureRow({
  eyebrow,
  title,
  href,
  cta,
  shot,
  flip = false,
  children,
}: {
  eyebrow: string;
  title: string;
  href: string;
  cta: string;
  shot: ReactNode;
  flip?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="grid items-center gap-6 lg:grid-cols-2 lg:gap-10">
      <div className={flip ? 'lg:order-2' : ''}>
        <div className="hud-label">{eyebrow}</div>
        <h3 className="mt-2 text-xl font-bold tracking-tight text-ink sm:text-2xl">{title}</h3>
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-dim">{children}</div>
        <LinkButton href={href} className="mt-5">
          {cta}
          <Arrow />
        </LinkButton>
      </div>
      <div className={flip ? 'lg:order-1' : ''}>{shot}</div>
    </div>
  );
}

/** A claim the app makes about itself, with the measurement that backs it. */
export function Claim({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="relative overflow-hidden rounded-lg border border-line bg-surface p-4 shadow-[var(--c-shadow)]">
      <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />
      <div className="num text-xs font-semibold text-accent-ink">{n}</div>
      <h3 className="mt-2 text-sm font-semibold tracking-tight text-ink">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-dim">{children}</p>
    </div>
  );
}

/** The three-step onboarding card. Copy is shared with the Import view's hero. */
export function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="num text-xs font-semibold text-accent-ink">{n}</div>
      <div className="mt-2 text-sm font-semibold text-ink">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-dim">{body}</p>
    </div>
  );
}

/** The trailing arrow on every "go to the app" link. */
export function Arrow() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="shrink-0">
      <path
        d="M3 8h9M8.5 4.5 12 8l-3.5 3.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
