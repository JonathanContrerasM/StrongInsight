/**
 * Rising bars: the same mark as the favicon, so the tab and the page agree.
 *
 * Lives in `ui/` rather than in App because the landing page uses it too, and a
 * second hand-copied set of four `<rect>`s is exactly the kind of thing that
 * drifts. Colour comes from the chart ramp, so it re-themes with everything else.
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="6" y="19" width="4" height="7" rx="1" fill="var(--chart-seq-5)" />
      <rect x="12" y="14" width="4" height="12" rx="1" fill="var(--chart-seq-6)" />
      <rect x="18" y="9" width="4" height="17" rx="1" fill="var(--chart-seq-7)" />
      <rect x="24" y="5" width="4" height="21" rx="1" fill="var(--c-accent)" />
    </svg>
  );
}

/** The wordmark as it appears in both headers. */
export function Wordmark() {
  return <span className="text-sm font-bold tracking-[0.14em] text-ink">STRONGINSIGHT</span>;
}
