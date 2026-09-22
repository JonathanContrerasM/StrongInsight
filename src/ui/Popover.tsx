import { useEffect, useRef, type ReactNode } from 'react';

/**
 * A panel anchored under its trigger. Closes on Escape, on a press outside,
 * or when the caller says so; it is not a portal, because the sticky header
 * it lives in has `backdrop-blur`, which makes `fixed` descendants position
 * against the header rather than the viewport. `absolute` under a `relative`
 * wrapper needs nothing of the sort, and stays inside the header's z-index.
 */
export function Popover({
  open,
  onClose,
  label,
  anchor,
  children,
  className = '',
}: {
  open: boolean;
  onClose: () => void;
  /** Accessible name for the panel. */
  label: string;
  /** The trigger, rendered in place. */
  anchor: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onPress = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPress);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPress);
    };
  }, [open, onClose]);

  return (
    <div ref={ref} className={'relative ' + className}>
      {anchor}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className="absolute right-0 top-full z-50 mt-2 rounded-lg border border-line-strong bg-raised p-3 text-sm text-ink shadow-lg"
        >
          {children}
        </div>
      )}
    </div>
  );
}
