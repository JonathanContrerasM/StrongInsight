import { useRef, useState } from 'react';

/**
 * The drag-and-drop CSV target, shared by the Import and Compare views.
 *
 * Extracted rather than duplicated mainly because of the copy: the original text
 * says importing "replaces the current history, and the previous import is
 * archived", which is true on Import and flatly wrong on Compare. Anything that
 * has to say different things in different places is a prop, not a constant.
 */
export function CsvDropzone({
  onFile,
  busy = false,
  compact = false,
  title,
  busyTitle = 'Reading...',
  subtitle,
}: {
  onFile: (file: File) => void;
  busy?: boolean;
  /** Shorter padding, for when the zone is not the whole page. */
  compact?: boolean;
  title: string;
  busyTitle?: string;
  subtitle: string;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      onClick={() => inputRef.current?.click()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      className={
        'group cursor-pointer rounded-xl border-2 border-dashed transition-colors ' +
        (compact ? 'px-6 py-8 ' : 'px-6 py-14 ') +
        (dragging
          ? 'border-accent bg-accent-bg'
          : 'border-line-strong bg-surface hover:border-accent hover:bg-sunken')
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Reset so re-picking the same file fires onChange again.
          e.target.value = '';
        }}
      />
      <div className="flex flex-col items-center gap-3 text-center">
        <span
          className={
            'flex h-11 w-11 items-center justify-center rounded-full transition-colors ' +
            (dragging ? 'bg-accent text-accent-on' : 'bg-sunken text-dim group-hover:text-ink')
          }
          aria-hidden
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M10 13V3.5M10 3.5 6.5 7M10 3.5 13.5 7" />
            <path d="M3.5 12.5v2A2.5 2.5 0 0 0 6 17h8a2.5 2.5 0 0 0 2.5-2.5v-2" />
          </svg>
        </span>
        <div>
          <p className="text-base font-semibold text-ink">{busy ? busyTitle : title}</p>
          <p className="mt-1 text-sm text-dim">{subtitle}</p>
        </div>
      </div>
    </div>
  );
}
