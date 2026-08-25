import { useState } from 'react';
import { WorkoutDataProvider, useWorkoutData } from './store/useWorkoutData';
import { Import } from './views/Import';
import { TaggingTray } from './views/TaggingTray';
import { ExerciseList } from './views/ExerciseList';
import { SettingsView } from './views/Settings';
import { Dashboard } from './views/Dashboard';
import { Improvements } from './views/Improvements';
import { Compare } from './views/Compare';
import { ExerciseDetail } from './views/ExerciseDetail';
import { ThemeControl } from './ui/ThemeControl';
import { Badge, Notice } from './ui/primitives';
import { DISABLED_HINT, TABS, tabEnabled, type Tab } from './ui/tabs';

/** Rising bars: the same mark as the favicon, so the tab and the page agree. */
function BrandMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 32 32" aria-hidden className="shrink-0">
      <rect x="6" y="19" width="4" height="7" rx="1" fill="var(--chart-seq-5)" />
      <rect x="12" y="14" width="4" height="12" rx="1" fill="var(--chart-seq-6)" />
      <rect x="18" y="9" width="4" height="17" rx="1" fill="var(--chart-seq-7)" />
      <rect x="24" y="5" width="4" height="21" rx="1" fill="var(--c-accent)" />
    </svg>
  );
}

function Shell() {
  const data = useWorkoutData();
  // Land on Import until there is something to look at.
  const [tab, setTab] = useState<Tab>('dashboard');
  const [detail, setDetail] = useState<string | null>(null);

  if (data.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-sm text-dim">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        Loading your history...
      </div>
    );
  }

  const hasData = data.current !== null;
  /**
   * A fallback, not the mechanism. Every data-dependent tab is rendered disabled
   * below, so this cannot be reached by clicking -- it catches `hasData` going
   * false underneath a live tab, which is what "Reset everything" does.
   */
  const activeTab: Tab = tabEnabled(tab, hasData) ? tab : 'import';

  const openExercise = (name: string) => {
    setDetail(name);
    setTab('exercises');
  };

  const select = (id: Tab) => {
    setTab(id);
    setDetail(null);
  };

  const trayCount = data.unconfirmedCount;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[100rem] px-4 sm:px-6">
          <div className="flex h-14 items-center gap-3">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <span className="text-sm font-bold tracking-[0.14em] text-ink">STRONGINSIGHT</span>
            </div>

            <nav className="ml-4 hidden h-14 items-center gap-1 md:flex" aria-label="Sections">
              {TABS.map((t) => {
                const active = activeTab === t.id;
                const enabled = tabEnabled(t.id, hasData);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => select(t.id)}
                    disabled={!enabled}
                    title={enabled ? undefined : DISABLED_HINT}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'relative flex h-14 items-center gap-1.5 px-3 text-sm font-medium transition-colors ' +
                      // Not `pointer-events-none`: that would suppress the title
                      // tooltip, which is the only thing explaining the lock.
                      // `disabled` already blocks the click on its own.
                      'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-dim ' +
                      (active ? 'text-ink' : 'text-dim hover:text-ink')
                    }
                  >
                    {t.label}
                    {t.id === 'tray' && trayCount > 0 && (
                      <Badge tone="warn" className="num">
                        {trayCount}
                      </Badge>
                    )}
                    {/* The accent rail: sits exactly on the header border. */}
                    {active && (
                      <span aria-hidden className="absolute inset-x-2 bottom-0 h-0.5 bg-accent" />
                    )}
                  </button>
                );
              })}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <span className="hud-label hidden lg:inline">local only</span>
              <ThemeControl size="sm" />
            </div>
          </div>

          {/* Below md the tab rail becomes its own scrollable row. */}
          <nav
            className="-mx-1 flex gap-1 overflow-x-auto pb-2 md:hidden"
            aria-label="Sections"
          >
            {TABS.map((t) => {
              const active = activeTab === t.id;
              const enabled = tabEnabled(t.id, hasData);
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => select(t.id)}
                  disabled={!enabled}
                  title={enabled ? undefined : DISABLED_HINT}
                  aria-current={active ? 'page' : undefined}
                  className={
                    'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium transition-colors ' +
                    'disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:text-dim ' +
                    (active ? 'bg-accent-bg text-accent-ink' : 'text-dim hover:text-ink')
                  }
                >
                  {t.label}
                  {t.id === 'tray' && trayCount > 0 && (
                    <Badge tone="warn" className="num">
                      {trayCount}
                    </Badge>
                  )}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[100rem] flex-1 px-4 py-6 sm:px-6">
        {(data.warnings.length > 0 || data.metaIndex.issues.length > 0) && (
          <div className="mb-5 space-y-3">
            {data.warnings.length > 0 && (
              <Notice tone="warn" title="Some stored data could not be read and was reset">
                <ul className="mt-1 space-y-0.5">
                  {data.warnings.map((w, i) => (
                    <li key={i}>
                      <code className="num rounded bg-surface px-1">{w.key}</code>: {w.message}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}

            {data.metaIndex.issues.length > 0 && (
              <Notice tone="warn" title="Alias problems">
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {data.metaIndex.issues.map((iss, i) => (
                    <li key={i}>
                      {iss.kind === 'alias-cycle'
                        ? 'Cycle between: ' + iss.names.join(' -> ')
                        : iss.kind === 'alias-dangling'
                          ? iss.name + ' aliases "' + iss.target + '", which does not exist'
                          : iss.name + ' has an alias chain that is too deep'}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <Dashboard onSelectExercise={openExercise} onGoToTray={() => setTab('tray')} />
        )}
        {activeTab === 'improvements' && <Improvements onSelectExercise={openExercise} />}
        {activeTab === 'compare' && <Compare />}
        {activeTab === 'exercises' &&
          (detail ? (
            <ExerciseDetail
              name={detail}
              onBack={() => setDetail(null)}
              onSelectExercise={setDetail}
            />
          ) : (
            <ExerciseList onSelectExercise={setDetail} />
          ))}
        {activeTab === 'tray' && <TaggingTray />}
        {activeTab === 'import' && <Import />}
        {activeTab === 'settings' && <SettingsView />}
      </main>

      <footer className="mx-auto w-full max-w-[100rem] px-4 pb-8 pt-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-4">
          <span className="hud-label">StrongInsight</span>
          <span className="text-xs text-faint">
            Every calculation runs in this browser. Your export is never uploaded.
          </span>
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <WorkoutDataProvider>
      <Shell />
    </WorkoutDataProvider>
  );
}
