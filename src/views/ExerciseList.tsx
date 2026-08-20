import { useMemo, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { summariseAll } from '../derive';
import { formatDate, formatVolume, formatWeight } from '../format';

type SortKey = 'sets' | 'name' | 'volume' | 'last' | 'e1rm';

/** The sanity-check surface: every exercise, its metadata, and what it derives to. */
export function ExerciseList({ onSelectExercise }: { onSelectExercise?: (name: string) => void }) {
  const data = useWorkoutData();
  const [sort, setSort] = useState<SortKey>('sets');
  const [filter, setFilter] = useState('');
  const [onlyUnconfirmed, setOnlyUnconfirmed] = useState(false);

  const summaries = useMemo(() => summariseAll(data.sets), [data.sets]);

  const rows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = summaries.filter((s) => {
      if (q && !s.name.toLowerCase().includes(q)) return false;
      if (onlyUnconfirmed && data.meta[s.name]?.confirmed === true) return false;
      return true;
    });
    out.sort((a, b) => {
      switch (sort) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'volume':
          return b.volume.volumeKg - a.volume.volumeKg;
        case 'last':
          return (b.lastDate?.getTime() ?? 0) - (a.lastDate?.getTime() ?? 0);
        case 'e1rm':
          return (b.bestE1rmKg ?? 0) - (a.bestE1rmKg ?? 0);
        default:
          return b.counts.total - a.counts.total;
      }
    });
    return out;
  }, [summaries, filter, onlyUnconfirmed, sort, data.meta]);

  if (data.current === null) return <p className="text-slate-500">Import a CSV first.</p>;

  const unit = data.settings.displayUnit;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">Filter</span>
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="exercise name"
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">Sort by</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-slate-300 px-2 py-1 text-sm"
          >
            <option value="sets">Set count</option>
            <option value="volume">Volume</option>
            <option value="e1rm">Best e1RM</option>
            <option value="last">Last performed</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label className="flex items-center gap-2 pb-1 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={onlyUnconfirmed}
            onChange={(e) => setOnlyUnconfirmed(e.target.checked)}
          />
          only unconfirmed
        </label>
        <p className="pb-1 text-sm text-slate-500">
          {rows.length} of {summaries.length} exercises
          {onSelectExercise && (
            <span className="ml-2 text-slate-400">
              &mdash; click any row for its full history and charts
            </span>
          )}
        </p>
      </div>

      <div className="overflow-x-auto rounded border border-slate-200">
        <table className="w-full min-w-[64rem] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Exercise</th>
              <th className="px-3 py-2">Equipment</th>
              <th className="px-3 py-2">Load type</th>
              <th className="px-3 py-2">Primary</th>
              <th className="px-3 py-2">Pattern</th>
              <th className="px-3 py-2 text-right">Sets</th>
              <th className="px-3 py-2 text-right">Volume</th>
              <th className="px-3 py-2 text-right">Best e1RM</th>
              <th className="px-3 py-2 text-right">Heaviest</th>
              <th className="px-3 py-2">Range</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((s) => {
              const m = data.meta[s.name];
              const confirmed = m?.confirmed === true;
              const excluded = s.volume.excludedSets;
              return (
                <tr
                  key={s.name}
                  // The whole row is the target, and it reacts on hover: the name
                  // alone looked like static text, so the detail view went unnoticed.
                  onClick={() => onSelectExercise?.(s.name)}
                  className={
                    (confirmed ? '' : 'bg-amber-50/40 ') +
                    (onSelectExercise ? 'cursor-pointer hover:bg-sky-50' : '')
                  }
                >
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      className="group inline-flex items-center gap-1 text-left font-medium text-slate-900 hover:text-sky-700 hover:underline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectExercise?.(s.name);
                      }}
                    >
                      <span aria-hidden className="text-slate-400 group-hover:text-sky-600">
                        &rsaquo;
                      </span>
                      {s.name}
                    </button>
                    {!confirmed && (
                      <span
                        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                        title="Metadata is an unconfirmed guess"
                      >
                        unverified
                      </span>
                    )}
                    {m?.aliasOf && (
                      <span className="ml-2 text-xs text-slate-500">&rarr; {m.aliasOf}</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-600">{m?.equipment ?? '-'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{m?.loadType ?? '-'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{m?.primaryMuscle ?? '-'}</td>
                  <td className="px-3 py-1.5 text-slate-600">{m?.pattern ?? '-'}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {s.counts.total}
                    {s.counts.warmup > 0 && (
                      <span className="text-slate-400"> +{s.counts.warmup}w</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {s.volume.volumeKg > 0 ? formatVolume(s.volume.volumeKg, unit) : '-'}
                    {excluded > 0 && (
                      <span
                        className="ml-1 text-xs text-amber-700"
                        title={
                          excluded +
                          ' set(s) excluded: ' +
                          s.volume.excludedUnloaded +
                          ' unloaded, ' +
                          s.volume.excludedNoLoad +
                          ' no resolvable load, ' +
                          s.volume.excludedNoReps +
                          ' no reps'
                        }
                      >
                        ({excluded} excl.)
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatWeight(s.bestE1rmKg, unit, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {formatWeight(s.heaviestKg, unit, 0)}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500 tabular-nums">
                    {formatDate(s.firstDate)} - {formatDate(s.lastDate)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
