import { THEMES, useTheme, type Theme } from './theme';

/**
 * Light / dark / system switch.
 *
 * Icons are inline SVG rather than an icon dependency -- there are exactly three
 * of them, and the app ships no icon library or asset pipeline.
 */

const LABEL: Record<Theme, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'System',
};

function Icon({ theme }: { theme: Theme }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
  if (theme === 'light') {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3.1" />
        <path d="M8 1v1.6M8 13.4V15M15 8h-1.6M2.6 8H1M12.9 3.1l-1.1 1.1M4.2 11.8l-1.1 1.1M12.9 12.9l-1.1-1.1M4.2 4.2L3.1 3.1" />
      </svg>
    );
  }
  if (theme === 'dark') {
    return (
      <svg {...common}>
        <path d="M13.5 9.6A5.9 5.9 0 016.4 2.5a5.9 5.9 0 107.1 7.1z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="1.75" y="2.75" width="12.5" height="8.5" rx="1.25" />
      <path d="M5.5 14h5" />
    </svg>
  );
}

export function ThemeControl({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const { theme, setTheme } = useTheme();
  const pad = size === 'sm' ? 'p-1' : 'p-1.5';

  return (
    <div
      role="group"
      aria-label="Colour theme"
      className="inline-flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
    >
      {THEMES.map((t) => {
        const active = theme === t;
        return (
          <button
            key={t}
            type="button"
            aria-pressed={active}
            title={LABEL[t]}
            onClick={() => setTheme(t)}
            className={
              'rounded transition-colors ' +
              pad +
              ' ' +
              (active ? 'bg-accent-bg text-accent-ink' : 'text-faint hover:bg-surface hover:text-ink')
            }
          >
            <Icon theme={t} />
            <span className="sr-only">{LABEL[t]}</span>
          </button>
        );
      })}
    </div>
  );
}
