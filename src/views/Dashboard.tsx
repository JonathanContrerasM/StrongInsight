import { useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { useAnalytics } from '../store/useAnalytics';
import { CalendarCard } from '../viz/TrainingCalendar';
import { SplitPanel } from '../viz/SplitMatrix';
import { HabitHeatmap, MuscleHeatmap, type MuscleScale } from '../viz/Heatmaps';
import { StackedVolume, BalanceChart } from '../viz/TimeSeries';
import { RepHistogram } from '../viz/Distributions';
import { ChartCard, Toggle, UnverifiedChip } from '../charts/parts';
import { volume, setCounts } from '../derive';
import { formatDate, formatVolume } from '../format';
import type { Granularity } from '../derive/buckets';
import type { GroupBy } from '../derive/balance';

export function Dashboard({
  onSelectExercise,
  onGoToTray,
}: {
  onSelectExercise: (name: string) => void;
  onGoToTray: () => void;
}) {
  const data = useWorkoutData();
  const [granularity, setGranularity] = useState<Granularity>('week');
  const [groupBy, setGroupBy] = useState<GroupBy>('muscle');
  const [calendarMode, setCalendarMode] = useState<'intensity' | 'split'>('intensity');
  const [muscleScale, setMuscleScale] = useState<MuscleScale>('relative');

  const a = useAnalytics({ granularity, groupBy });
  const unit = data.settings.displayUnit;

  if (data.current === null) {
    return <p className="text-slate-500">Import a CSV to see your dashboard.</p>;
  }

  const totals = volume(a.sets);
  const counts = setCounts(a.sets);
  const trainedDays = a.days.filter((d) => d.hasWorkout).length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Tile label="Sessions" value={data.workouts.length.toLocaleString()} />
        <Tile label="Sets" value={counts.total.toLocaleString()} />
        <Tile label="Exercises" value={data.observed.size.toLocaleString()} />
        <Tile label="Total volume" value={formatVolume(totals.volumeKg, unit)} />
        <Tile
          label="Consistency"
          value={a.days.length ? Math.round((trainedDays / a.days.length) * 100) + '%' : '-'}
          hint={trainedDays + ' of ' + a.days.length + ' days'}
        />
        <Tile
          label="Range"
          value={
            data.report.dateRange
              ? formatDate(data.report.dateRange.from).slice(2) +
                ' → ' +
                formatDate(data.report.dateRange.to).slice(2)
              : '-'
          }
        />
      </div>

      <CalendarCard
        days={a.days}
        unit={unit}
        mode={calendarMode}
        clusterOf={a.clusterOfDay}
        clusterLabels={a.clusterLabels}
        actions={
          <Toggle
            value={calendarMode}
            onChange={setCalendarMode}
            options={[
              { value: 'intensity', label: 'Intensity' },
              { value: 'split', label: 'Split' },
            ]}
          />
        }
      />

      <SplitPanel result={a.split} onSelectExercise={onSelectExercise} />

      <ChartCard
        title="Volume over time"
        subtitle={'Stacked by ' + (groupBy === 'muscle' ? 'muscle group' : 'movement pattern') + '.'}
        actions={
          <>
            <UnverifiedChip unconfirmed={a.unconfirmedSets} total={a.sets.length} onClick={onGoToTray} />
            <Toggle
              value={groupBy}
              onChange={setGroupBy}
              options={[
                { value: 'muscle', label: 'Muscle' },
                { value: 'pattern', label: 'Pattern' },
              ]}
            />
            <Toggle
              value={granularity}
              onChange={setGranularity}
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
            <UnverifiedChip
              unconfirmed={a.detailedMuscleMatrix.unconfirmedSets}
              total={a.detailedMuscleMatrix.totalSets}
              onClick={onGoToTray}
            />
            <Toggle
              value={muscleScale}
              onChange={setMuscleScale}
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Push / pull balance"
          subtitle="Ratio of pull to push volume, on a log scale so both directions read symmetrically."
          actions={<UnverifiedChip unconfirmed={a.unconfirmedSets} total={a.sets.length} onClick={onGoToTray} />}
          note={a.verdict.flags.length > 0 ? a.verdict.flags.join('. ') + '.' : undefined}
        >
          <BalanceChart points={a.balance} metric="pullPushLog2" labels={['pull', 'push']} />
        </ChartCard>

        <ChartCard
          title="Upper / lower balance"
          subtitle="Ratio of lower-body to upper-body volume."
          actions={<UnverifiedChip unconfirmed={a.unconfirmedSets} total={a.sets.length} onClick={onGoToTray} />}
        >
          <BalanceChart points={a.balance} metric="lowerUpperLog2" labels={['lower', 'upper']} />
        </ChartCard>
      </div>

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
    </div>
  );
}

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}
