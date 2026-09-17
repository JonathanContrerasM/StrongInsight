import { useMemo, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { useAnalytics } from '../store/useAnalytics';
import { sessionSummaries } from '../derive/sessions';
import { formatDate, formatDuration, formatVolume } from '../format';
import { Badge, EmptyState, Field, Input, SectionLabel } from '../ui/primitives';
import { Td, Th } from '../ui/table';

type SortKey = 'date' | 'volume' | 'sets' | 'duration';

/**
 * Every workout, newest first. The Exercises tab answers "how is this lift
 * going"; this one answers "what did I actually do on that day", which the
 * calendar could only hint at through a tooltip.
 */
export function SessionList({
  onSelectSession,
  onSelectExercise,
}: {
  onSelectSession: (workoutId: string) => void;
  onSelectExercise?: (name: string) => void;
}) {
  const data = useWorkoutData();
  const a = useAnalytics({ granularity: 'week', groupBy: 'muscle' });
  const [sort, setSort] = useState<SortKey>('date');
  const [filter, setFilter] = useState('');

  const summaries = useMemo(
    () => sessionSummaries(data.scopedSets, data.scopedWorkouts),
    [data.scopedSets, data.scopedWorkouts],
  );

  /**
   * Which recovered split group a session belongs to, via the same rule the
   * calendar's split mode uses -- so the two never disagree about a day.
   */
  const dayByKey = useMemo(() => new Map(a.days.map((d) => [d.key, d])), [a.days]);
  const clusterOf = (date: Date): string | null => {
    const day = dayByKey.get(formatDate(date));
    if (!day) return null;
    const c = a.clusterOfDay(day);
    return c === null ? null : (a.clusterLabels[c] ?? null);
  };

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = summaries.filter((s) => {
      if (!q) return true;
      if (formatDate(s.date).includes(q)) return true;
      return s.exercises.some((e) => e.toLowerCase().includes(q));
    });
    out.sort((a, b) => {
      switch (sort) {
        case 'volume':
          return b.volume.volumeKg - a.volume.volumeKg;
        case 'sets':
          return b.setCount - a.setCount;
        case 'duration':
          return b.durationSec - a.durationSec;
        default:
          return b.date.getTime() - a.date.getTime();
      }
    });
    return out;
  }, [summaries, filter, sort]);

  const maxVolume = useMemo(
    () => rows.reduce((m, s) => Math.max(m, s.volume.volumeKg), 0),
    [rows],
  );

  if (data.current === null) {
    return <EmptyState title="Nothing imported yet">Import a CSV first.</EmptyState>;
  }

  const unit = data.settings.displayUnit;

  return (
    <div className="space-y-4">
      <SectionLabel>Sessions</SectionLabel>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-3">
        <Field label="Filter" className="w-56">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="date or exercise"
          />
        </Field>
        <p className="ml-auto pb-2 text-xs text-dim">
          <span className="num text-ink">{rows.length}</span> of{' '}
          <span className="num text-ink">{summaries.length}</span> sessions
          <span className="text-faint"> &mdash; click a row for every set</span>
        </p>
      </div>

      {/* Same scroll box as the Exercises table; see the comment there. */}
      <div className="overflow-auto rounded-lg border border-line bg-surface md:max-h-[calc(100vh-13rem)]">
        <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
          <thead className="z-10 bg-sunken md:sticky md:top-0">
            <tr>
              <Th sortKey="date" sort={sort} onSort={setSort}>
                Date
              </Th>
              <Th>Split</Th>
              <Th>Exercises</Th>
              <Th sortKey="sets" sort={sort} onSort={setSort} align="right">
                Sets
              </Th>
              <Th sortKey="volume" sort={sort} onSort={setSort} align="right">
                Volume
              </Th>
              <Th sortKey="duration" sort={sort} onSort={setSort} align="right">
                Duration
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((s) => {
              const pct = maxVolume > 0 ? (s.volume.volumeKg / maxVolume) * 100 : 0;
              const cluster = clusterOf(s.date);
              return (
                <tr
                  key={s.workoutId}
                  onClick={() => onSelectSession(s.workoutId)}
                  className="group cursor-pointer transition-colors hover:bg-sunken"
                >
                  <td className="py-2 pl-3 pr-3">
                    <div className="num font-medium text-ink group-hover:text-accent-ink">
                      {formatDate(s.date)}
                    </div>
                    {/* Strong's label is the time of day, not the routine. */}
                    <div className="text-xs text-faint" title="Strong's auto-generated label">
                      {s.name || '-'}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {cluster ? <Badge tone="accent">{cluster}</Badge> : <span className="text-faint">-</span>}
                  </td>
                  <td className="max-w-md px-3 py-2">
                    <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                      {s.exercises.map((name) => (
                        <button
                          key={name}
                          type="button"
                          className={
                            'text-xs text-dim ' +
                            (onSelectExercise ? 'hover:text-accent-ink' : 'cursor-default')
                          }
                          onClick={(e) => {
                            // A lift, not the session: keep the row click out of it.
                            e.stopPropagation();
                            onSelectExercise?.(name);
                          }}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </td>
                  <Td align="right" mono>
                    {s.workingSets}
                    {s.setCount !== s.workingSets && (
                      <span
                        className="text-faint"
                        title={s.setCount - s.workingSets + ' warm-up or drop sets'}
                      >
                        {' '}
                        +{s.setCount - s.workingSets}
                      </span>
                    )}
                  </Td>
                  <td className="px-3 py-2 text-right">
                    <div className="num text-ink">
                      {s.volume.volumeKg > 0 ? formatVolume(s.volume.volumeKg, unit) : '-'}
                    </div>
                    {pct > 0 && (
                      <div className="mt-1 ml-auto h-0.5 w-20 overflow-hidden rounded-full bg-sunken">
                        <span
                          className="block h-full rounded-full bg-accent opacity-70"
                          style={{ width: Math.max(2, pct) + '%' }}
                        />
                      </div>
                    )}
                  </td>
                  <Td align="right" mono muted>
                    {formatDuration(s.durationSec)}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
