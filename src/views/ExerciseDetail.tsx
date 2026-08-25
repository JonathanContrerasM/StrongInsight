import { useMemo } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { ProgressionChart, LoadSplitChart, SessionPeaksChart } from '../viz/TimeSeries';
import { DensityHeatmap } from '../viz/Heatmaps';
import { SetPositionChart, RepHistogram } from '../viz/Distributions';
import { ChartCard, NotEnoughData } from '../charts/parts';
import { Badge, Card, SectionLabel, Tile } from '../ui/primitives';
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

  const sets = useMemo(() => data.sets.filter((s) => s.canonicalName === name), [data.sets, name]);

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

  /**
   * When the best e1RM was actually hit. Read off the already-computed session
   * series rather than adding anything to the derive layer -- a personal best
   * with no date attached is trivia.
   */
  const bestDate = useMemo(() => {
    if (summary.bestE1rmKg === null) return null;
    let found: Date | null = null;
    for (const s of sessions) {
      if (s.bestE1rmKg !== null && s.bestE1rmKg === summary.bestE1rmKg) {
        if (found === null || s.date < found) found = s.date;
      }
    }
    return found;
  }, [sessions, summary.bestE1rmKg]);

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
    <div className="space-y-8">
      <BackLink onBack={onBack} />

      <section>
        <Card rail padded={false} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-2xl font-bold tracking-tight text-ink">{name}</h2>
                {meta && !meta.confirmed && (
                  <Badge tone="warn" dot>
                    unverified
                  </Badge>
                )}
              </div>
              {meta && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge>{meta.equipment}</Badge>
                  <Badge>{meta.loadType}</Badge>
                  <Badge>{meta.primaryMuscle}</Badge>
                  <Badge>{meta.pattern}</Badge>
                  {meta.unilateral && <Badge>unilateral</Badge>}
                </div>
              )}
            </div>

            {/*
             * The record gets its own display treatment. As six identical tiles,
             * the best e1RM read exactly like "First" and "Last" -- the one number
             * on this page anybody actually came for, given equal billing with a
             * calendar date.
             */}
            <div className="rounded-lg border border-line bg-sunken px-4 py-2.5">
              <div className="hud-label">Best e1RM</div>
              <div className="num text-3xl font-bold tracking-tight text-accent-ink">
                {formatWeight(summary.bestE1rmKg, unit, 1)}
              </div>
              <div className="text-xs text-faint">
                {bestDate ? 'set ' + formatDate(bestDate) : 'no estimable set'}
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <Tile
              label="Sets"
              value={String(summary.counts.total)}
              hint={summary.counts.warmup + ' warm-up'}
            />
            <Tile label="Volume" value={formatVolume(summary.volume.volumeKg, unit)} />
            <Tile label="Heaviest" value={formatWeight(summary.heaviestKg, unit, 1)} />
            <Tile label="First" value={formatDate(summary.firstDate)} />
            <Tile label="Last" value={formatDate(summary.lastDate)} />
          </div>

          {summary.volume.excludedSets > 0 && (
            <p className="mt-3 text-xs text-faint">
              {summary.volume.includedSets} of {summary.counts.total} sets counted toward volume
              &mdash; {summary.volume.excludedUnloaded} unloaded, {summary.volume.excludedNoLoad}{' '}
              with no resolvable load, {summary.volume.excludedNoReps} with no reps.
            </p>
          )}
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>Progression</SectionLabel>

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
      </section>

      <section>
        <SectionLabel>How it is programmed</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard title="Where your sets land" subtitle="Effective load against reps.">
            <DensityHeatmap density={density} unit={unit} />
          </ChartCard>

          <ChartCard title="Set position profile" subtitle="Do you ramp up, hold steady, or fade?">
            <SetPositionChart profile={profile} unit={unit} />
          </ChartCard>

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
              <ul className="divide-y divide-line">
                {partners.map((p) => (
                  <li key={p.name} className="flex items-center justify-between gap-3 py-1.5">
                    <button
                      type="button"
                      className="text-left text-sm text-ink transition-colors hover:text-accent-ink"
                      onClick={() => onSelectExercise(p.name)}
                    >
                      {p.name}
                    </button>
                    <span className="num shrink-0 text-xs text-faint">
                      {p.shared} shared &middot; {p.sim.toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </ChartCard>
        </div>
      </section>
    </div>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm text-dim transition-colors hover:text-ink"
    >
      <span aria-hidden>&larr;</span> All exercises
    </button>
  );
}
