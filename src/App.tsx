import { useEffect, useRef, useState } from 'react';
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
import { BrandMark, Wordmark } from './ui/BrandMark';
import { Badge, Notice } from './ui/primitives';
import {
  DEFAULT_ROUTE,
  DISABLED_HINT,
  TABS,
  hashForRoute,
  routeFromHash,
  tabEnabled,
  type Route,
  type Tab,
} from './ui/tabs';

function Shell() {
  const data = useWorkoutData();
  /**
   * ONE piece of navigation state, seeded from the URL hash. Tab and open lift
   * used to be separate, and the lift was never written to the hash -- so
   * opening one created no history entry and Back skipped the Exercises list.
   *
   * This is still not a router. There is one page and one piece of state; the
   * state just has an address now.
   */
  const [route, setRoute] = useState<Route>(() =>
    typeof window === 'undefined' ? DEFAULT_ROUTE : (routeFromHash(window.location.hash) ?? DEFAULT_ROUTE),
  );

  /**
   * True once this session has pushed a history entry of its own, which is what
   * makes `history.back()` safe for the in-app back link. Someone who landed
   * straight on `#exercises/Bench Press` -- a bookmark, a reload, a link -- has
   * nothing of ours behind them, so popping would eject them from the app.
   */
  const hasPushed = useRef(false);

  // Back and forward. Note the absent `if (next)`: an unrecognised or absent
  // hash resolves to DEFAULT_ROUTE rather than being ignored, so Back to a bare
  // /app.html shows what a cold load of /app.html shows instead of freezing.
  useEffect(() => {
    const onHash = () => setRoute(routeFromHash(window.location.hash) ?? DEFAULT_ROUTE);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

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
  const activeTab: Tab = tabEnabled(route.tab, hasData) ? route.tab : 'import';

  /**
   * The single place the hash is written, so the URL can never disagree with the
   * nav. Assigning a hash equal to the current one fires no `hashchange`, which
   * is what stops this looping -- and the same comparison records whether we
   * actually pushed an entry.
   */
  const goTo = (tab: Tab, detail: string | null = null) => {
    setRoute({ tab, detail });
    if (typeof window === 'undefined') return;
    const next = hashForRoute(tab, detail);
    if (window.location.hash !== next) {
      hasPushed.current = true;
      window.location.hash = next;
    }
  };

  const openExercise = (name: string) => goTo('exercises', name);
  const select = (id: Tab) => goTo(id);

  /**
   * The in-app back link pops rather than pushes, so it undoes the step that
   * opened the lift instead of adding another -- otherwise browser Back would
   * appear to go forward, back onto the lift you just left.
   */
  const backToList = () => {
    if (hasPushed.current && typeof window !== 'undefined') window.history.back();
    else goTo('exercises');
  };

  const trayCount = data.unconfirmedCount;

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto w-full max-w-[100rem] px-4 sm:px-6">
          <div className="flex h-14 items-center gap-3">
            <div className="flex items-center gap-2.5">
              <BrandMark />
              <Wordmark />
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
          <Dashboard onSelectExercise={openExercise} onGoToTray={() => select('tray')} />
        )}
        {activeTab === 'improvements' && <Improvements onSelectExercise={openExercise} />}
        {activeTab === 'compare' && <Compare />}
        {activeTab === 'exercises' &&
          (route.detail ? (
            <ExerciseDetail
              name={route.detail}
              onBack={backToList}
              onSelectExercise={(n) => goTo('exercises', n)}
            />
          ) : (
            <ExerciseList onSelectExercise={(n) => goTo('exercises', n)} />
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
