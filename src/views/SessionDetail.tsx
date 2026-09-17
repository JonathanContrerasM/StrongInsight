import { useMemo } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { sessionDetail, sessionSummaries } from '../derive/sessions';
import { e1rm } from '../derive';
import { records, type RecordEvent } from '../derive/records';
import { describe as describeRecord } from './RecordList';
import { NotEnoughData } from '../charts/parts';
import { Badge, Card, SectionLabel, Tile } from '../ui/primitives';
import { formatDate, formatDuration, formatVolume, formatWeight } from '../format';
import type { EnrichedSet } from '../model/effectiveLoad';
import type { WeightUnit } from '../model/types';

/**
 * One workout, every set. The only view that shows the rows more or less as
 * Strong logged them -- which is the point: every chart in the app is a
 * derivation, and this is where a surprising number can be checked against
 * what was actually done.
 */
export function SessionDetail({
  workoutId,
  onBack,
  onSelectSession,
  onSelectExercise,
}: {
  workoutId: string;
  onBack: () => void;
  onSelectSession: (id: string) => void;
  onSelectExercise: (name: string) => void;
}) {
  const data = useWorkoutData();
  const unit = data.settings.displayUnit;

  const session = useMemo(
    () => sessionDetail(data.sets, data.workouts, workoutId),
    [data.sets, data.workouts, workoutId],
  );

  /**
   * Records set in this session, by the set that did it. Records are relative
   * to everything before, so this needs the whole corpus, not the session.
   */
  const recordsBySet = useMemo(() => {
    const m = new Map<string, RecordEvent[]>();
    for (const e of records(data.sets)) {
      if (e.workoutId !== workoutId) continue;
      const list = m.get(e.setId);
      if (list) list.push(e);
      else m.set(e.setId, [e]);
    }
    return m;
  }, [data.sets, workoutId]);
  const recordCount = useMemo(
    () => [...recordsBySet.values()].reduce((n, l) => n + l.length, 0),
    [recordsBySet],
  );

  /** Newest first, so "previous" is the later index. Neighbours follow the scope. */
  const neighbours = useMemo(() => {
    const all = sessionSummaries(data.scopedSets, data.scopedWorkouts);
    const i = all.findIndex((s) => s.workoutId === workoutId);
    if (i < 0) return { prev: null, next: null };
    return { prev: all[i + 1] ?? null, next: all[i - 1] ?? null };
  }, [data.scopedSets, data.scopedWorkouts, workoutId]);

  if (session === null) {
    return (
      <div className="space-y-3">
        <BackLink onBack={onBack} />
        <NotEnoughData need="This session is not in the current import. A re-import with different data can retire a link." />
      </div>
    );
  }

  const time = session.date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink onBack={onBack} />
        <div className="flex items-center gap-2 text-sm">
          <NeighbourLink label="Previous" target={neighbours.prev} onSelect={onSelectSession} />
          <span className="text-faint">&middot;</span>
          <NeighbourLink label="Next" target={neighbours.next} onSelect={onSelectSession} />
        </div>
      </div>

      <section>
        <Card rail padded={false} className="p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="num text-2xl font-bold tracking-tight text-ink">
                {formatDate(session.date)}
              </h2>
              <div className="mt-1 text-xs text-faint">
                {time}
                {session.name && (
                  <>
                    {' '}
                    &middot; <span title="Strong's auto-generated label, not a routine name">{session.name}</span>
                  </>
                )}
              </div>
            </div>
            <div className="flex gap-2">
              {recordCount > 0 && (
                <div className="rounded-lg border border-line bg-sunken px-4 py-2.5">
                  <div className="hud-label">Records</div>
                  <div className="num text-3xl font-bold tracking-tight text-good">{recordCount}</div>
                </div>
              )}
              <div className="rounded-lg border border-line bg-sunken px-4 py-2.5">
                <div className="hud-label">Volume</div>
                <div className="num text-3xl font-bold tracking-tight text-accent-ink">
                  {session.volume.volumeKg > 0 ? formatVolume(session.volume.volumeKg, unit) : '-'}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="Duration" value={formatDuration(session.durationSec)} />
            <Tile label="Exercises" value={String(session.exerciseCount)} />
            <Tile
              label="Sets"
              value={String(session.workingSets)}
              hint={
                session.setCount !== session.workingSets
                  ? '+' + (session.setCount - session.workingSets) + ' warm-up / drop'
                  : undefined
              }
            />
            <Tile
              label="Density"
              value={
                session.durationSec > 0 && session.volume.volumeKg > 0
                  ? formatVolume(session.volume.volumeKg / (session.durationSec / 60), unit) + '/min'
                  : '-'
              }
            />
          </div>

          {session.volume.excludedSets > 0 && (
            <p className="mt-3 text-xs text-faint">
              {session.volume.includedSets} of {session.setCount} sets counted toward volume
              &mdash; {session.volume.excludedUnloaded} unloaded, {session.volume.excludedNoLoad}{' '}
              with no resolvable load, {session.volume.excludedNoReps} with no reps.
            </p>
          )}
        </Card>
      </section>

      <section className="space-y-4">
        <SectionLabel>In order</SectionLabel>
        {session.blocks.map((block) => {
          const meta = data.meta[block.name];
          return (
            <Card
              key={block.name}
              title={
                <button
                  type="button"
                  className="text-left transition-colors hover:text-accent-ink"
                  onClick={() => onSelectExercise(block.name)}
                >
                  {block.name}
                </button>
              }
              subtitle={
                <span className="flex flex-wrap items-center gap-1.5">
                  {meta && !meta.confirmed && (
                    <Badge tone="warn" dot>
                      unverified
                    </Badge>
                  )}
                  {meta && <Badge>{meta.primaryMuscle}</Badge>}
                  {meta && <Badge>{meta.loadType}</Badge>}
                </span>
              }
              actions={
                <span className="num text-xs text-dim">
                  {block.sets.length} {block.sets.length === 1 ? 'set' : 'sets'}
                  {block.volume.volumeKg > 0 && (
                    <> &middot; {formatVolume(block.volume.volumeKg, unit)}</>
                  )}
                </span>
              }
            >
              <SetTable sets={block.sets} unit={unit} recordsBySet={recordsBySet} />
            </Card>
          );
        })}
      </section>
    </div>
  );
}

/**
 * The set rows. Optional columns appear only when any set in the block has the
 * value: most exports carry no RPE and no rest, and six empty columns would
 * bury the four that matter.
 */
function SetTable({
  sets,
  unit,
  recordsBySet,
}: {
  sets: EnrichedSet[];
  unit: WeightUnit;
  recordsBySet: Map<string, RecordEvent[]>;
}) {
  const anyRpe = sets.some((s) => s.rpe !== null);
  const anyRest = sets.some((s) => s.restAfterSec !== null);
  const anySeconds = sets.some((s) => (s.seconds ?? 0) > 0);
  const anyNotes = sets.some((s) => s.notes.length > 0);
  const bodyweightRelative = sets.some(
    (s) => s.loadType === 'bodyweight' || s.loadType === 'bodyweight-plus' || s.loadType === 'assisted',
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="text-xs">
            <th className="hud-label py-1 pr-3 font-medium">#</th>
            <th className="hud-label py-1 pr-3 text-right font-medium">Load</th>
            <th className="hud-label py-1 pr-3 text-right font-medium">Reps</th>
            {anySeconds && <th className="hud-label py-1 pr-3 text-right font-medium">Time</th>}
            <th className="hud-label py-1 pr-3 text-right font-medium">e1RM</th>
            {anyRpe && <th className="hud-label py-1 pr-3 text-right font-medium">RPE</th>}
            {anyRest && <th className="hud-label py-1 pr-3 text-right font-medium">Rest</th>}
            {anyNotes && <th className="hud-label py-1 font-medium">Notes</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {sets.map((s) => {
            const est = e1rm(s);
            const prs = recordsBySet.get(s.id) ?? [];
            return (
              <tr key={s.id} className={s.setKind === 'working' ? '' : 'text-dim'}>
                <td className="num py-1.5 pr-3">
                  <span className="inline-flex items-center gap-1.5">
                    {s.setOrder}
                    {s.setKind === 'warmup' && <Badge>warm-up</Badge>}
                    {s.setKind === 'dropset' && <Badge>drop</Badge>}
                    {prs.map((e) => (
                      <Badge key={e.id} tone="good" title={describeRecord(e, unit)}>
                        PR
                      </Badge>
                    ))}
                  </span>
                </td>
                <td className="num py-1.5 pr-3 text-right">
                  <LoadCell set={s} unit={unit} bodyweightRelative={bodyweightRelative} />
                </td>
                <td className="num py-1.5 pr-3 text-right">{s.reps ?? '-'}</td>
                {anySeconds && (
                  <td className="num py-1.5 pr-3 text-right">
                    {(s.seconds ?? 0) > 0 ? s.seconds + ' s' : '-'}
                  </td>
                )}
                <td className="num py-1.5 pr-3 text-right text-dim">
                  {est === null ? '-' : formatWeight(est, unit, 0)}
                </td>
                {anyRpe && <td className="num py-1.5 pr-3 text-right">{s.rpe ?? '-'}</td>}
                {anyRest && (
                  <td className="num py-1.5 pr-3 text-right">
                    {/* null is "no rest row followed", which is not zero. */}
                    {s.restAfterSec === null ? '-' : formatRest(s.restAfterSec)}
                  </td>
                )}
                {anyNotes && <td className="py-1.5 text-xs text-dim">{s.notes || ''}</td>}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Effective load, with the bodyweight component made visible on movements
 * where it is most of the number: "85 kg" on a pull up is only honest next to
 * the "+5" that was actually logged.
 */
function LoadCell({
  set: s,
  unit,
  bodyweightRelative,
}: {
  set: EnrichedSet;
  unit: WeightUnit;
  bodyweightRelative: boolean;
}) {
  if (s.isUnloaded) {
    return (
      <span className="text-faint" title="Logged at weight 0 on an external-load exercise">
        unloaded
      </span>
    );
  }
  if (s.effectiveLoadKg === null) return <span className="text-faint">-</span>;
  const added = s.weightKg ?? 0;
  return (
    <span>
      {formatWeight(s.effectiveLoadKg, unit, 1)}
      {bodyweightRelative && (
        <span className="ml-1 text-xs text-faint">
          {s.loadType === 'assisted'
            ? '(-' + formatWeight(added, unit, 0) + ')'
            : added > 0
              ? '(+' + formatWeight(added, unit, 0) + ')'
              : '(bw)'}
        </span>
      )}
    </span>
  );
}

function formatRest(sec: number): string {
  if (sec < 60) return sec + ' s';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? m + ' min' : m + ':' + String(s).padStart(2, '0');
}

function NeighbourLink({
  label,
  target,
  onSelect,
}: {
  label: string;
  target: { workoutId: string; date: Date } | null;
  onSelect: (id: string) => void;
}) {
  if (!target) return <span className="text-faint">{label}</span>;
  return (
    <button
      type="button"
      className="text-dim transition-colors hover:text-ink"
      onClick={() => onSelect(target.workoutId)}
    >
      {label} <span className="num text-xs text-faint">{formatDate(target.date)}</span>
    </button>
  );
}

function BackLink({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-1.5 text-sm text-dim transition-colors hover:text-ink"
    >
      <span aria-hidden>&larr;</span> All sessions
    </button>
  );
}
