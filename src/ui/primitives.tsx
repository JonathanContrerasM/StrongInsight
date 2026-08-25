import type { ReactNode } from 'react';

/**
 * Generic, domain-free UI primitives.
 *
 * These live outside `charts/` on purpose. The layering rule is that `charts/`
 * never imports `model/` or `derive/`; `ui/` imports nothing at all, so both
 * `charts/` and `views/` may depend on it.
 *
 * Colour comes only from the semantic tokens in index.css -- no `slate-*`, no
 * hex, and no `dark:` variants, because the tokens already swap themselves.
 */

// --- surfaces -----------------------------------------------------------------

export function Card({
  title,
  subtitle,
  actions,
  note,
  rail = false,
  padded = true,
  className = '',
  children,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  note?: ReactNode;
  /** Draws the accent rail down the leading edge. Marks a primary card. */
  rail?: boolean;
  padded?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={
        'relative overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--c-shadow)] ' +
        (padded ? 'p-4 ' : '') +
        className
      }
    >
      {rail && <span aria-hidden className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
      {(title || actions) && (
        <header
          className={
            'flex flex-wrap items-start justify-between gap-x-3 gap-y-2 ' +
            (padded ? 'mb-3' : 'border-b border-line p-4')
          }
        >
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold tracking-tight text-ink">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs leading-relaxed text-dim">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
      {note && <p className="mt-3 border-t border-line pt-2 text-xs text-faint">{note}</p>}
    </section>
  );
}

/** Section heading for a view. The rule doubles as the HUD horizon line. */
export function SectionLabel({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center gap-3">
      <span className="hud-label whitespace-nowrap">{children}</span>
      <span aria-hidden className="h-px flex-1 bg-line" />
      {actions}
    </div>
  );
}

export type Tone = 'neutral' | 'warn' | 'danger' | 'good' | 'accent';

const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-ink',
  warn: 'text-warn',
  danger: 'text-danger',
  good: 'text-good',
  accent: 'text-accent-ink',
};

/**
 * The metric tile. Replaces the three near-identical copies that used to live in
 * Dashboard, ExerciseDetail and Import.
 */
export function Tile({
  label,
  value,
  hint,
  tone = 'neutral',
  size = 'md',
  className = '',
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const valueSize = size === 'lg' ? 'text-2xl sm:text-3xl' : size === 'sm' ? 'text-sm' : 'text-lg';
  return (
    <div
      className={
        'rounded-lg border border-line bg-surface px-3 py-2.5 shadow-[var(--c-shadow)] ' + className
      }
    >
      <div className="hud-label truncate">{label}</div>
      <div className={'num mt-1 font-semibold tracking-tight ' + valueSize + ' ' + TONE_TEXT[tone]}>
        {value}
      </div>
      {hint && <div className="mt-0.5 truncate text-xs text-faint">{hint}</div>}
    </div>
  );
}

// --- controls -----------------------------------------------------------------

export type ButtonVariant = 'primary' | 'default' | 'ghost' | 'danger';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // Solid lime is reserved for real actions, so it stays meaningful.
  primary: 'bg-accent text-accent-on hover:bg-accent-hover font-semibold',
  default: 'border border-line-strong bg-surface text-ink hover:bg-sunken',
  ghost: 'text-dim hover:bg-sunken hover:text-ink',
  danger: 'border border-danger-line bg-danger-bg text-danger hover:border-danger',
};

export function Button({
  variant = 'default',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: {
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={
        'inline-flex items-center justify-center gap-1.5 rounded-md transition-colors ' +
        'disabled:pointer-events-none disabled:opacity-50 ' +
        (size === 'sm' ? 'px-2.5 py-1 text-xs font-medium ' : 'px-3 py-1.5 text-sm font-medium ') +
        BUTTON_VARIANT[variant] +
        ' ' +
        className
      }
      {...rest}
    />
  );
}

const BADGE_TONE: Record<Tone, string> = {
  neutral: 'bg-sunken text-dim',
  warn: 'bg-warn-bg text-warn',
  danger: 'bg-danger-bg text-danger',
  good: 'bg-good-bg text-good',
  accent: 'bg-accent-bg text-accent-ink',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  className = '',
  children,
  ...rest
}: {
  tone?: Tone;
  dot?: boolean;
  children: ReactNode;
} & React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={
        'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium ' +
        BADGE_TONE[tone] +
        ' ' +
        className
      }
      {...rest}
    >
      {dot && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

/**
 * The segmented switch used for every chart option.
 *
 * Active reads as a lime TINT rather than a lime fill: a chart header can carry
 * three of these at once, and three solid accent chips would fight both each
 * other and the primary buttons.
 */
export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={
              'rounded px-2.5 py-1 text-xs font-medium transition-colors ' +
              (active ? 'bg-accent-bg text-accent-ink' : 'text-dim hover:bg-surface hover:text-ink')
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Label + control pairing, so every form field in the app lines up. */
/**
 * Note that `hint` renders BELOW the control and so adds to the field's height.
 * In a row aligned with `items-end`, mixing hinted and unhinted fields therefore
 * pushes the hinted one's input upward by the height of its caption. Put the
 * hint on all of them or none of them, or move it out of the row entirely.
 */
export function Field({
  label,
  hint,
  className = '',
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={'block ' + className}>
      <span className="hud-label mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

const CONTROL_BASE =
  'w-full rounded-md border border-line bg-sunken px-2.5 py-1.5 text-sm text-ink ' +
  'placeholder:text-faint transition-colors hover:border-line-strong focus:border-accent';

export function Input({ className = '', ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={CONTROL_BASE + ' ' + className} {...rest} />;
}

export function Select({
  className = '',
  children,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  // `color-scheme` on :root is what makes the native popup dark; without it the
  // option list renders light-on-dark and is unreadable.
  return (
    <select className={CONTROL_BASE + ' ' + className} {...rest}>
      {children}
    </select>
  );
}

export function Checkbox({
  label,
  className = '',
  ...rest
}: { label: ReactNode } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={'inline-flex cursor-pointer items-center gap-2 text-sm text-dim ' + className}>
      <input type="checkbox" className="h-3.5 w-3.5 accent-[var(--c-accent)]" {...rest} />
      {label}
    </label>
  );
}

// --- states -------------------------------------------------------------------

export function EmptyState({
  title,
  children,
  action,
}: {
  title?: ReactNode;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line p-6 text-center">
      {title && <p className="text-sm font-medium text-ink">{title}</p>}
      <p className="max-w-sm text-sm text-dim">{children}</p>
      {action}
    </div>
  );
}

/** Thin progress meter. Used for the tagging queue. */
export function Meter({ value, max, label }: { value: number; max: number; label?: string }) {
  const pct = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <div
      className="h-1 w-full overflow-hidden rounded-full bg-sunken"
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <span
        className="block h-full rounded-full bg-accent transition-[width]"
        style={{ width: pct + '%' }}
      />
    </div>
  );
}

/** Inline notice. One component for every warning/error/success banner. */
export function Notice({
  tone = 'warn',
  title,
  children,
}: {
  tone?: 'warn' | 'danger' | 'good';
  title?: ReactNode;
  children?: ReactNode;
}) {
  const cls =
    tone === 'danger'
      ? 'border-danger-line bg-danger-bg text-danger'
      : tone === 'good'
        ? 'border-good-line bg-good-bg text-good'
        : 'border-warn-line bg-warn-bg text-warn';
  return (
    <div className={'rounded-lg border p-3 text-sm ' + cls}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-1' : ''}>{children}</div>}
    </div>
  );
}
