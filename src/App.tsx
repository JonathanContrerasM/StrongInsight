import { useState } from 'react';
import { WorkoutDataProvider, useWorkoutData } from './store/useWorkoutData';
import { Import } from './views/Import';
import { TaggingTray } from './views/TaggingTray';
import { ExerciseList } from './views/ExerciseList';
import { SettingsView } from './views/Settings';
import { Dashboard } from './views/Dashboard';
import { ExerciseDetail } from './views/ExerciseDetail';

type Tab = 'dashboard' | 'import' | 'tray' | 'exercises' | 'settings';

const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'exercises', label: 'Exercises' },
  { id: 'tray', label: 'Tagging tray' },
  { id: 'import', label: 'Import' },
  { id: 'settings', label: 'Settings' },
];

function Shell() {
  const data = useWorkoutData();
  // Land on Import until there is something to look at.
  const [tab, setTab] = useState<Tab>('dashboard');
  const [detail, setDetail] = useState<string | null>(null);

  if (data.status === 'loading') {
    return <div className="p-8 text-slate-500">Loading...</div>;
  }

  const hasData = data.current !== null;
  const activeTab: Tab = !hasData && tab === 'dashboard' ? 'import' : tab;

  const openExercise = (name: string) => {
    setDetail(name);
    setTab('exercises');
  };

  return (
    <div className="mx-auto max-w-7xl p-6">
      <header className="mb-6">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">StrongInsight</h1>
        <p className="text-sm text-slate-500">
          Local-first analysis of a Strong CSV export. Nothing leaves this browser.
        </p>
      </header>

      {data.warnings.length > 0 && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Some stored data could not be read and was reset:</p>
          <ul className="mt-1 list-inside list-disc">
            {data.warnings.map((w, i) => (
              <li key={i}>
                <code>{w.key}</code>: {w.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.metaIndex.issues.length > 0 && (
        <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Alias problems:</p>
          <ul className="mt-1 list-inside list-disc">
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
        </div>
      )}

      <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setDetail(null);
            }}
            className={
              'relative -mb-px border-b-2 px-3 py-2 text-sm font-medium ' +
              (activeTab === t.id
                ? 'border-slate-900 text-slate-900'
                : 'border-transparent text-slate-500 hover:text-slate-800')
            }
          >
            {t.label}
            {t.id === 'tray' && data.unconfirmedCount > 0 && (
              <span className="ml-1.5 rounded-full bg-amber-200 px-1.5 py-0.5 text-xs text-amber-900">
                {data.unconfirmedCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <main>
        {activeTab === 'dashboard' && (
          <Dashboard onSelectExercise={openExercise} onGoToTray={() => setTab('tray')} />
        )}
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
