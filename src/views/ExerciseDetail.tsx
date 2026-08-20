import { useMemo } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { ProgressionChart, LoadSplitChart, SessionPeaksChart } from '../viz/TimeSeries';
import { DensityHeatmap } from '../viz/Heatmaps';
import { SetPositionChart, RepHistogram } from '../viz/Distributions';
import { ChartCard, NotEnoughData } from '../charts/parts';
import { summarise } from '../derive';
import { sessionBests, smoothSessionBests, bodyweightVsAddedSeries } from '../derive/series';
import { loadRepDensity, repDensity, setPositionProfile } from '../derive/profile';
import { cooccurrence } from '../derive/cooccurrence';
import { formatDate, formatVolume, formatWeight } from '../format';

export function ExerciseDetail({
  name,
  onBack,
  onSelectExercise,
}: {
  name: string;
  onBack: () => void;
  onSelectExercise: (n: string) => void;
}) {
  const data = useWorkoutData();
  const unit = data.settings.displayUnit;
  const meta = data.meta[name];

  const sets = useMemo(
    () => data.sets.filter((s) => s.canonicalName === name),
    [data.sets, name],
  );

  const summary = useMemo(() => summarise(name, sets), [name, sets]);
  const sessions = useMemo(() => sessionBests(sets), [sets]);
  const progression = useMemo(() => smoothSessionBests(sessions), [sessions]);
  const density = useMemo(() => loadRepDensity(sets), [sets]);
  const profile = useMemo(() => setPositionProfile(sets), [sets]);
  const reps = useMemo(() => repDensity(sets), [sets]);
  const loadSplit = useMemo(
    () =>
      bodyweightVsAddedSeries(sets, {
        granularity: 'month',
        weekStartsOn: data.settings.weekStartsOn,
      }),
    [sets, data.settings.weekStartsOn],
  );

  /** Partners come straight from the corpus-wide matrix; no new computation. */
  const partners = useMemo(() => {
    const co = cooccurrence(data.sets, (n) => data.meta[n], { minAppearances: 2 });
    const i = co.order.indexOf(name);
    if (i < 0) return [];
    return co.order
      .map((n, j) => ({ name: n, sim: co.similarity[i]?.[j] ?? 0, shared: co.counts[i]?.[j] ?? 0 }))
      .filter((r) => r.name !== name && r.shared > 0)
      .sort((a, b) => b.sim - a.sim)
      .slice(0, 8);
  }, [data.sets, data.meta, name]);

  const isBodyweightRelative =
    meta?.loadType === 'bodyweight' ||
    meta?.loadType === 'bodyweight-plus' ||
    meta?.loadType === 'assisted';

  if (sets.length === 0) {
    return (
      <div className="space-y-3">
        <BackLink onBack={onBack} />
        <NotEnoughData need={'No sets found for "' + name + '" in the current import.'} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <BackLink onBack={onBack} />

      <header className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">
            {name}
            {meta && !meta.confirmed && (
              <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">
                unverified
              </span>
            )}
          </h2>
          {meta && (
            <div className="text-xs text-slate-500">
              {meta.equipment} &middot; {meta.loadType} &middot; {meta.primaryMuscle} &middot;{' '}
              {meta.pattern}
              {meta.unilateral && ' · unilateral'}
            </div>
          )}
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label="Sets" value={String(summary.counts.total)} hint={summary.counts.warmup + ' warm-up'} />
          <Tile label="Volume" value={formatVolume(summary.volume.volumeKg, unit)} />
          <Tile label="Best e1RM" value={formatWeight(summary.bestE1rmKg, unit, 1)} />
          <Tile label="Heaviest" value={formatWeight(summary.heaviestKg, unit, 1)} />
          <Tile label="First" value={formatDate(summary.firstDate)} />
          <Tile label="Last" value={formatDate(summary.lastDate)} />
        </div>

        {summary.volume.excludedSets > 0 && (
          <p className="mt-2 text-xs text-slate-500">
            {summary.volume.includedSets} of {summary.counts.total} sets counted toward volume —{' '}
            {summary.volume.excludedUnloaded} unloaded, {summary.volume.excludedNoLoad} with no
            resolvable load, {summary.volume.excludedNoReps} with no reps.
          </p>
        )}
      </header>

      <ChartCard
        title="Strength progression"
        subtitle="Estimated 1RM per session, smoothed so deload weeks do not read as regression."
      >
        {/* Heaviest gets its own card below, so this one stays about capability. */}
        <ProgressionChart points={progression} unit={unit} showHeaviest={false} />
      </ChartCard>

      <ChartCard
        title="Per session: heaviest load and volume"
        subtitle="What you peaked at each session, against how much total work that session carried."
      >
        <SessionPeaksChart points={sessions} unit={unit} />
      </ChartCard>

      {isBodyweightRelative && (
        <ChartCard
          title="Bodyweight versus added load"
          subtitle="Most of these sets are logged at weight 0 but carry your full bodyweight."
          note={
            data.bodyweightAt.isFallback
              ? 'No bodyweight recorded, so ' +
                data.settings.defaultBodyweightKg +
                ' kg is assumed throughout. Add entries in Settings to make this real.'
              : undefined
          }
        >
          <LoadSplitChart points={loadSplit} unit={unit} />
        </ChartCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Where your sets land" subtitle="Effective load against reps.">
          <DensityHeatmap density={density} unit={unit} />
        </ChartCard>

        <ChartCard title="Set position profile" subtitle="Do you ramp up, hold steady, or fade?">
          <SetPositionChart profile={profile} unit={unit} />
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Rep zones" subtitle="How this movement is actually programmed.">
          <RepHistogram bins={reps} />
        </ChartCard>

        <ChartCard
          title="Trained alongside"
          subtitle="The exercises that most often share a session with this one."
        >
          {partners.length === 0 ? (
            <NotEnoughData need="Not enough shared sessions yet." />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {partners.map((p) => (
                <li key={p.name} className="flex items-center justify-between py-1.5">
                  <button
                    type="button"
                    className="text-left text-slate-700 hover:underline"
                    onClick={() => onSelectExercise(p.name)}
                  >
                    {p.name}
                  </button>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {p.shared} shared &middot; {p.sim.toFixed(2)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ChartCard>
      </div>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button type="button" onClick={onBack} className="text-sm text-slate-500 hover:text-slate-800">
      &larr; Back
    </button>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-slate-200 px-2 py-1.5">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-slate-900 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
