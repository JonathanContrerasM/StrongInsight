import { UTILITY_TABS, type Tab } from './tabs';

/**
 * Import and Settings as icons beside the theme switch.
 *
 * They are housekeeping, not analysis, and as text tabs they pushed the header
 * past one row. Same pill and inline-SVG approach as ThemeControl, so the two
 * groups read as one family.
 */

function Icon({ tab }: { tab: Tab }) {
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
  if (tab === 'import') {
    // A tray with an arrow going in.
    return (
      <svg {...common}>
        <path d="M8 1.75v7.5M5 6.5l3 3 3-3" />
        <path d="M1.75 10v2.5c0 .97.78 1.75 1.75 1.75h9c.97 0 1.75-.78 1.75-1.75V10" />
      </svg>
    );
  }
  // A gear: six teeth around a hub.
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="2.1" />
      <path d="M8 1.5v1.7M8 12.8v1.7M14.5 8h-1.7M3.2 8H1.5M12.6 3.4l-1.2 1.2M4.6 11.4l-1.2 1.2M12.6 12.6l-1.2-1.2M4.6 4.6L3.4 3.4" />
      <circle cx="8" cy="8" r="4.6" />
    </svg>
  );
}

export function UtilityNav({ active, onSelect }: { active: Tab; onSelect: (tab: Tab) => void }) {
  return (
    <nav
      aria-label="Data and settings"
      className="inline-flex items-center gap-0.5 rounded-md border border-line bg-sunken p-0.5"
    >
      {UTILITY_TABS.map((t) => {
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            type="button"
            title={t.label}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(t.id)}
            className={
              'rounded p-1 transition-colors ' +
              (isActive ? 'bg-accent-bg text-accent-ink' : 'text-faint hover:bg-surface hover:text-ink')
            }
          >
            <Icon tab={t.id} />
            <span className="sr-only">{t.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
