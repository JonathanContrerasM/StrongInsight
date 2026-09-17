import { useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { useAnalytics } from '../store/useAnalytics';
import { CalendarCard } from '../viz/TrainingCalendar';
import { SplitPanel } from '../viz/SplitMatrix';
import { HabitHeatmap, MuscleHeatmap, type MuscleScale } from '../viz/Heatmaps';
import { StackedVolume, BalanceChart } from '../viz/TimeSeries';
import { RepHistogram } from '../viz/Distributions';
import { RecordsChart } from '../viz/Records';
import { RecordList } from './RecordList';
import { ChartCard, Toggle, UnverifiedChip } from '../charts/parts';
import { Button, EmptyState, Notice, SectionLabel, Tile } from '../ui/primitives';
import { isBodyweightRelative } from '../model/effectiveLoad';
import { volume, setCounts, daysBetween } from '../derive';
import { formatDate, formatVolume } from '../format';
import type { Granularity } from '../derive/buckets';
import type { GroupBy } from '../derive/balance';

/** "Recent" on the records rail, in days before the last session. */
const RECENT_DAYS = 90;
const RECENT_LIST = 10;

export function Dashboard({
  onSelectExercise,
  onSelectSession,
  onGoToTray,
  onGoToImport,
}: {
  onSelectExercise: (name: string) => void;
  /** A workout id, or null for the sessions list -- a day logged as two sessions. */
  onSelectSession: (workoutId: string | null) => void;
  onGoToTray: () => void;
  onGoToImport: () => void;
}) {
  const data = useWorkoutData();
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [groupBy, setGroupBy] = useState<GroupBy>('muscle');
  const [calendarMode, setCalendarMode] = useState<'intensity' | 'split'>('intensity');
  const [muscleScale, setMuscleScale] = useState<MuscleScale>('relative');

  const a = useAnalytics({ granularity, groupBy });
  const unit = data.settings.displayUnit;

  if (data.current === null) {
    return <EmptyState title="Nothing imported yet">Import a CSV to see your dashboard.</EmptyState>;
  }

  const totals = volume(a.sets);
  const counts = setCounts(a.sets);
  const trainedDays = a.days.filter((d) => d.hasWorkout).length;
  const exerciseCount = new Set(a.sets.map((s) => s.canonicalName)).size;
  // The nudge for the one thing a new import asks for. Only when it matters:
  // an export with no bodyweight movement has nothing to resolve.
  const assumedBodyweight =
    data.bodyweightAt.isFallback && data.sets.some((s) => isBodyweightRelative(s.loadType));

  // Recency is against the last session in the corpus, never the wall clock --
  // the same rule the insights engine follows, and the only one that reads
  // sensibly against an export from three months ago.
  const lastDay = a.days[a.days.length - 1]?.date ?? null;
  const recentRecords = lastDay
    ? a.records.filter((e) => daysBetween(e.date, lastDay) <= RECENT_DAYS)
    : [];
  const lastRecord = a.records[a.records.length - 1] ?? null;
  const newestRecords = a.records.slice(-RECENT_LIST).reverse();

  return (
    <div className="space-y-8">
      {/*
       * The headline rail. Four numbers at display size, and the two that are
       * context rather than achievement demoted to the meta line below -- the old
       * six-across grid gave "Range" the same weight as "Total volume".
       */}
      <section>
        <SectionLabel
          actions={
            <UnverifiedChip
              unconfirmed={a.unconfirmedSets}
              total={a.sets.length}
              onClick={onGoToTray}
            />
          }
        >
          Overview
        </SectionLabel>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile
            label="Total volume"
            value={formatVolume(totals.volumeKg, unit)}
            size="lg"
            tone="accent"
          />
          <Tile label="Sessions" value={data.scopedWorkouts.length.toLocaleString()} size="lg" />
          <Tile label="Sets" value={counts.total.toLocaleString()} size="lg" />
          <Tile
            label="Consistency"
            value={a.days.length ? Math.round((trainedDays / a.days.length) * 100) + '%' : '-'}
            hint={trainedDays + ' of ' + a.days.length + ' days'}
            size="lg"
          />
        </div>
        {assumedBodyweight && (
          <div className="mt-3">
            <Notice tone="warn" title={'Bodyweight movements are counted at an assumed ' + data.settings.defaultBodyweightKg + ' kg.'}>
              <div className="flex flex-wrap items-center gap-3">
                <span>Every pull up, dip and push up resolves against it until you record your own.</span>
                <Button size="sm" onClick={onGoToImport}>
                  Add your bodyweight
                </Button>
              </div>
            </Notice>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 px-1 text-xs text-dim">
          <span>
            <span className="hud-label">Exercises</span>{' '}
            <span className="num text-ink">{exerciseCount.toLocaleString()}</span>
          </span>
          <span>
            <span className="hud-label">Range</span>{' '}
            <span className="num text-ink">
              {a.days.length > 0
                ? formatDate(a.days[0]?.date ?? null) +
                  ' → ' +
                  formatDate(a.days[a.days.length - 1]?.date ?? null)
                : '-'}
            </span>
            {data.scope !== null && (
              <span className="text-faint"> (last {data.scope} months)</span>
            )}
          </span>
        </div>
      </section>

      <section className="space-y-4">
        <SectionLabel>Records</SectionLabel>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile
            label={'Records, last ' + RECENT_DAYS + ' days'}
            value={recentRecords.length.toLocaleString()}
            hint={lastDay ? 'to ' + formatDate(lastDay) : undefined}
            size="lg"
            tone={recentRecords.length > 0 ? 'good' : 'neutral'}
          />
          <Tile label="Records, all time" value={a.records.length.toLocaleString()} size="lg" />
          <Tile
            label="Last record"
            value={lastRecord ? formatDate(lastRecord.date) : '-'}
            hint={lastRecord ? lastRecord.exercise : 'none yet'}
            size="lg"
            className="col-span-2"
          />
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Records per month"
            subtitle="A new best load, a new estimated 1RM, or more reps at a load already lifted. An exercise's first session sets none."
          >
            <RecordsChart buckets={a.recordsMonthly} />
          </ChartCard>
          <ChartCard title="Most recent" subtitle="The newest records, and the sessions they were set in.">
            {newestRecords.length === 0 ? (
              <p className="text-xs text-dim">No records yet.</p>
            ) : (
              <RecordList
                events={newestRecords}
                unit={unit}
                onSelectExercise={onSelectExercise}
                onSelectSession={(id) => onSelectSession(id)}
              />
            )}
          </ChartCard>
        </div>
      </section>

      <section>
        <SectionLabel>Consistency</SectionLabel>
        <CalendarCard
          days={a.days}
          unit={unit}
          mode={calendarMode}
          onSelectDay={(d) => onSelectSession(d.workoutIds.length === 1 ? (d.workoutIds[0] ?? null) : null)}
          actions={
            <Toggle
              value={calendarMode}
              onChange={setCalendarMode}
              label="Calendar mode"
              options={[
                { value: 'intensity', label: 'Intensity' },
                { value: 'split', label: 'Split' },
              ]}
            />
          }
        />
      </section>

      <section>
        <SectionLabel>Structure</SectionLabel>
        <SplitPanel result={a.split} onSelectExercise={onSelectExercise} />
      </section>

      <section className="space-y-4">
        <SectionLabel>Volume</SectionLabel>

        <ChartCard
          title="Volume over time"
          subtitle={
            'Stacked by ' + (groupBy === 'muscle' ? 'muscle group' : 'movement pattern') + '.'
          }
          actions={
            <>
              <Toggle
                value={groupBy}
                onChange={setGroupBy}
                label="Group by"
                options={[
                  { value: 'muscle', label: 'Muscle' },
                  { value: 'pattern', label: 'Pattern' },
                ]}
              />
              <Toggle
                value={granularity}
                onChange={setGranularity}
                label="Granularity"
                options={[
                  { value: 'week', label: 'Weekly' },
                  { value: 'month', label: 'Monthly' },
                ]}
              />
            </>
          }
          note={
            totals.excludedSets > 0
              ? totals.includedSets.toLocaleString() +
                ' of ' +
                counts.total.toLocaleString() +
                ' sets counted — ' +
                totals.excludedSets.toLocaleString() +
                ' excluded (' +
                totals.excludedUnloaded +
                ' unloaded, ' +
                totals.excludedNoLoad +
                ' no resolvable load, ' +
                totals.excludedNoReps +
                ' no reps).'
              : undefined
          }
        >
          <StackedVolume matrix={a.matrix} unit={unit} />
        </ChartCard>

        <ChartCard
          title="Muscle emphasis over time"
          subtitle={
            muscleScale === 'relative'
              ? 'Each row against its own typical week, so a light muscle is not drowned out by a heavy one.'
              : 'Absolute volume. Heavy compound work dominates by construction.'
          }
          actions={
            <>
              {/* Kept per-card: this denominator genuinely differs from the
                  overview chip, which counts every set. */}
              <UnverifiedChip
                unconfirmed={a.detailedMuscleMatrix.unconfirmedSets}
                total={a.detailedMuscleMatrix.totalSets}
                onClick={onGoToTray}
              />
              <Toggle
                value={muscleScale}
                onChange={setMuscleScale}
                label="Scale"
                options={[
                  { value: 'relative', label: 'Relative' },
                  { value: 'absolute', label: 'Absolute' },
                ]}
              />
            </>
          }
        >
          <MuscleHeatmap matrix={a.detailedMuscleMatrix} unit={unit} scaleMode={muscleScale} />
        </ChartCard>
      </section>

      <section>
        <SectionLabel>Balance</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Push / pull balance"
            subtitle="Ratio of pull to push volume, on a log scale so both directions read symmetrically."
            note={a.verdict.flags.length > 0 ? a.verdict.flags.join('. ') + '.' : undefined}
          >
            <BalanceChart points={a.balance} metric="pullPushLog2" labels={['pull', 'push']} />
          </ChartCard>

          <ChartCard
            title="Upper / lower balance"
            subtitle="Ratio of upper-body to lower-body volume."
          >
            {/* `invert`, because the metric is log2(lower/upper): without it an
                upper-heavy week would be drawn below the line on a card titled
                "Upper / lower". */}
            <BalanceChart
              points={a.balance}
              metric="lowerUpperLog2"
              labels={['upper', 'lower']}
              invert
            />
          </ChartCard>
        </div>
      </section>

      <section>
        <SectionLabel>Habits</SectionLabel>
        <div className="grid gap-4 lg:grid-cols-2">
          <ChartCard
            title="Rep zones"
            subtitle="Every working set by rep count. Peaks are the schemes you actually run."
          >
            <RepHistogram bins={a.reps} />
          </ChartCard>

          <ChartCard
            title="When you train"
            subtitle={a.habit.totalWorkouts + ' sessions by weekday and hour.'}
          >
            <HabitHeatmap habit={a.habit} weekStartsOn={data.settings.weekStartsOn} />
          </ChartCard>
        </div>
      </section>
    </div>
  );
}
