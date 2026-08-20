import { useMemo, useState, type ReactNode } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { summariseAll } from '../derive';
import { formatDate, formatVolume, formatWeight } from '../format';
import { Badge, Checkbox, EmptyState, Field, Input, SectionLabel } from '../ui/primitives';

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

  /** Scales the inline volume bars. Recomputed per filter so the bars stay readable. */
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
      <SectionLabel>Exercises</SectionLabel>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-line bg-surface p-3">
        <Field label="Filter" className="w-56">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="exercise name"
          />
        </Field>
        <Checkbox
          label="only unconfirmed"
          className="pb-2"
          checked={onlyUnconfirmed}
          onChange={(e) => setOnlyUnconfirmed(e.target.checked)}
        />
        <p className="ml-auto pb-2 text-xs text-dim">
          <span className="num text-ink">{rows.length}</span> of{' '}
          <span className="num text-ink">{summaries.length}</span> exercises
          {onSelectExercise && (
            <span className="text-faint"> &mdash; click a row for its full history</span>
          )}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[64rem] border-collapse text-left text-sm">
          {/* Sortable headers replace the old sort dropdown: the sort belongs on
              the column it sorts, not in a control three feet away from it. */}
          {/* Sticky only from md up: below that the shell grows a second nav row,
              so a 3.5rem offset would park the header behind it. */}
          <thead className="z-10 bg-sunken md:sticky md:top-14">
            <tr>
              <Th sortKey="name" sort={sort} onSort={setSort}>
                Exercise
              </Th>
              <Th>Equipment</Th>
              <Th>Load type</Th>
              <Th>Primary</Th>
              <Th>Pattern</Th>
              <Th sortKey="sets" sort={sort} onSort={setSort} align="right">
                Sets
              </Th>
              <Th sortKey="volume" sort={sort} onSort={setSort} align="right">
                Volume
              </Th>
              <Th sortKey="e1rm" sort={sort} onSort={setSort} align="right">
                Best e1RM
              </Th>
              <Th align="right">Heaviest</Th>
              <Th sortKey="last" sort={sort} onSort={setSort}>
                Range
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((s) => {
              const m = data.meta[s.name];
              const confirmed = m?.confirmed === true;
              const excluded = s.volume.excludedSets;
              const pct = maxVolume > 0 ? (s.volume.volumeKg / maxVolume) * 100 : 0;
              return (
                <tr
                  key={s.name}
                  // The whole row is the target, and it reacts on hover: the name
                  // alone looked like static text, so the detail view went unnoticed.
                  onClick={() => onSelectExercise?.(s.name)}
                  className={
                    'group transition-colors ' +
                    (onSelectExercise ? 'cursor-pointer hover:bg-sunken ' : '')
                  }
                >
                  <td
                    className={
                      // An amber row tint does not survive a near-black surface;
                      // a warn-coloured leading rule does, in both themes.
                      'border-l-2 py-2 pl-3 pr-3 ' +
                      (confirmed ? 'border-l-transparent' : 'border-l-warn')
                    }
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink group-hover:text-accent-ink">
                        {s.name}
                      </span>
                      {!confirmed && (
                        <Badge tone="warn" dot title="Metadata is an unconfirmed guess">
                          unverified
                        </Badge>
                      )}
                      {m?.aliasOf && <span className="text-xs text-faint">&rarr; {m.aliasOf}</span>}
                    </div>
                  </td>
                  <Td muted>{m?.equipment ?? '-'}</Td>
                  <Td muted>{m?.loadType ?? '-'}</Td>
                  <Td muted>{m?.primaryMuscle ?? '-'}</Td>
                  <Td muted>{m?.pattern ?? '-'}</Td>
                  <Td align="right" mono>
                    {s.counts.total}
                    {s.counts.warmup > 0 && (
                      <span className="text-faint"> +{s.counts.warmup}w</span>
                    )}
                  </Td>
                  <td className="px-3 py-2 text-right">
                    <div className="num text-ink">
                      {s.volume.volumeKg > 0 ? formatVolume(s.volume.volumeKg, unit) : '-'}
                      {excluded > 0 && (
                        <span
                          className="ml-1 text-xs text-warn"
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
                    </div>
                    {/* The table doubles as a bar chart of relative volume. */}
                    {pct > 0 && (
                      <div className="mt-1 ml-auto h-0.5 w-20 overflow-hidden rounded-full bg-sunken">
                        <span
                          className="block h-full rounded-full bg-accent opacity-70"
                          style={{ width: Math.max(2, pct) + '%' }}
                        />
                      </div>
                    )}
                  </td>
                  <Td align="right" mono>
                    {formatWeight(s.bestE1rmKg, unit, 0)}
                  </Td>
                  <Td align="right" mono>
                    {formatWeight(s.heaviestKg, unit, 0)}
                  </Td>
                  <Td mono muted>
                    {formatDate(s.firstDate)} - {formatDate(s.lastDate)}
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

function Th({
  children,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  children: ReactNode;
  sortKey?: SortKey;
  sort?: SortKey;
  onSort?: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey !== undefined && sort === sortKey;
  const alignCls = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      scope="col"
      aria-sort={active ? 'descending' : undefined}
      className={'border-b border-line px-3 py-2 font-medium ' + alignCls}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={
            'hud-label inline-flex items-center gap-1 transition-colors hover:text-ink ' +
            (active ? 'text-accent-ink' : '')
          }
        >
          {children}
          <span aria-hidden className={active ? 'opacity-100' : 'opacity-0'}>
            &darr;
          </span>
        </button>
      ) : (
        <span className="hud-label">{children}</span>
      )}
    </th>
  );
}

function Td({
  children,
  align = 'left',
  mono = false,
  muted = false,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={
        'px-3 py-2 ' +
        (align === 'right' ? 'text-right ' : '') +
        (mono ? 'num ' : '') +
        (muted ? 'text-dim' : 'text-ink')
      }
    >
      {children}
    </td>
  );
}
