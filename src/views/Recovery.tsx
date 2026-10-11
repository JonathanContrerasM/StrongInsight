import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import {
  FATIGUE_LOOKBACK_DAYS,
  fatigueFrom,
  fatigueHistory,
  fatigueStimuli,
  groupReadiness,
  isStale,
  STALE_AFTER_DAYS,
  WEEKLY_SETS_TARGET,
  weeklyVolume,
  type FatigueState,
  type MuscleFatigue,
  type TrainingGroup,
} from '../derive/recovery';
import { FATIGUE } from '../charts/colour';
import { ChartCard, Toggle, UnverifiedChip } from '../charts/parts';
import { MUSCLE_LABEL, REGIONS_OF, regionFatigue } from '../viz/bodyRegions';
import type { BodyRegion } from '../viz/BodyMap';
import { WeeklySetsChart } from '../viz/WeeklySetsChart';
import { FatigueHistoryChart } from '../viz/FatigueHistory';
import { formatDate } from '../format';
import { Badge, CollapsibleSection, EmptyState, Notice, Tile, type Tone } from '../ui/primitives';

/**
 * Which muscles are still fatigued and which are ready to train again.
 *
 * The one view that is about NOW. Every other tab counts to the last session so
 * an old export does not read as months of neglect; here "now" is the question.
 * When the export is stale, though, decaying to today would only show a body
 * that has recovered from everything, so the view anchors to the end of the
 * last session instead and says so.
 *
 * Two clocks: the ANCHOR (now, or the end of the last session) is what volume
 * and history are measured to, because they are about what was done. The
 * FORECAST adds hours to it for the map, the list and "train today", which are
 * about what the body will be ready for.
 *
 * Reads the whole corpus, not the date-range scope: the model needs the weeks
 * before each recent session, and "how recovered am I" has no range.
 */

const BodyMap = lazy(() => import('../viz/BodyMap'));

const STATE_LABEL: Record<FatigueState, string> = {
  ready: 'Ready',
  recovering: 'Recovering',
  fatigued: 'Fatigued',
};
const STATE_TONE: Record<FatigueState, Tone> = {
  ready: 'good',
  recovering: 'warn',
  fatigued: 'danger',
};
const GROUP_LABEL: Record<TrainingGroup, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
};

type Anchor = 'now' | 'last';
type Forecast = '0' | '24' | '48' | '72';

const HOUR = 3_600_000;
const HISTORY_DAYS = 42;

function formatHours(h: number): string {
  if (h <= 0) return 'now';
  if (h < 1) return 'within the hour';
  if (h < 48) return 'in ~' + Math.round(h) + ' h';
  return 'in ~' + Math.round(h / 24) + ' d';
}

function formatAgo(then: Date | null, asOf: Date): string {
  if (!then) return 'never';
  const h = (asOf.getTime() - then.getTime()) / HOUR;
  if (h < 1) return 'just now';
  if (h < 48) return Math.round(h) + ' h ago';
  return Math.round(h / 24) + ' d ago';
}

function formatMoment(d: Date): string {
  return formatDate(d) + ', ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export function Recovery({ onGoToTray }: { onGoToTray?: () => void }) {
  const data = useWorkoutData();
  // Read once per visit: fatigue moves over hours, not seconds.
  const [now] = useState(() => new Date());
  const [selected, setSelected] = useState<string | null>(null);
  const [forecast, setForecast] = useState<Forecast>('0');

  // The end of the last session, so "as of last session" means right after it.
  const lastEnd = useMemo(() => {
    let end: number | null = null;
    for (const w of data.workouts) {
      const t = w.date.getTime() + Math.max(0, w.durationSec) * 1000;
      if (end === null || t > end) end = t;
    }
    return end === null ? null : new Date(end);
  }, [data.workouts]);

  const stale = lastEnd !== null && isStale(lastEnd, now);
  const [anchorChoice, setAnchor] = useState<Anchor | null>(null);
  const anchor: Anchor = anchorChoice ?? (stale ? 'last' : 'now');
  const anchorAt = anchor === 'last' && lastEnd ? lastEnd : now;
  const asOf = useMemo(
    () => (forecast === '0' ? anchorAt : new Date(anchorAt.getTime() + Number(forecast) * HOUR)),
    [anchorAt, forecast],
  );

  const lookup = useMemo(() => (name: string) => data.metaIndex.resolve(name).meta, [data.metaIndex]);
  // The expensive part, once per corpus; every moment below is read off it.
  const stimuli = useMemo(() => fatigueStimuli(data.sets, lookup), [data.sets, lookup]);
  const atAnchor = useMemo(() => fatigueFrom(stimuli, anchorAt), [stimuli, anchorAt]);
  const result = useMemo(() => (asOf === anchorAt ? atAnchor : fatigueFrom(stimuli, asOf)), [stimuli, asOf, anchorAt, atAnchor]);
  const history = useMemo(() => fatigueHistory(stimuli, anchorAt, HISTORY_DAYS), [stimuli, anchorAt]);

  const regions = useMemo(() => {
    const out = new Map<string, BodyRegion>();
    for (const [id, muscles] of regionFatigue(result.muscles)) {
      const top = muscles[0]!;
      out.set(id, {
        level: top.level,
        label: muscles.map((m) => MUSCLE_LABEL[m.muscle]).join(' / ') + ': ' + STATE_LABEL[top.state],
        tip: <RegionTip muscles={muscles} asOf={asOf} />,
      });
    }
    return out;
  }, [result, asOf]);

  if (data.current === null) {
    return <EmptyState title="Nothing imported yet">Import a CSV to see how recovered each muscle is.</EmptyState>;
  }

  const ranked = [...result.muscles].sort((a, b) => b.value - a.value);
  const active = ranked.filter((m) => m.value > 0.005);
  const idle = ranked.filter((m) => m.value <= 0.005);
  const groups = groupReadiness(result.muscles);
  const volume = weeklyVolume(atAnchor.muscles, anchorAt);
  const unconfirmed = result.muscles.filter((m) => m.unconfirmed).length;
  const isHighlighted = (m: MuscleFatigue) => selected !== null && REGIONS_OF[m.muscle].includes(selected);
  const mostOverreached = [...history.rows].sort((a, b) => b.overreachCount - a.overreachCount)[0];

  const todayLabel =
    forecast !== '0'
      ? 'Ready to train in ' + forecast + ' h'
      : anchor === 'now'
        ? 'Train today'
        : 'After the last session';

  return (
    <div className="space-y-8">
      {stale && lastEnd && (
        <Notice tone="warn" title={'The last session is more than ' + STALE_AFTER_DAYS + ' days old.'}>
          The last session ended {formatDate(lastEnd)}. As of today every muscle would read as recovered, so the
          page {anchor === 'last' ? 'shows the state right after that session' : 'is showing today anyway'}.
          Import a fresh export from Strong for today&apos;s picture.
        </Notice>
      )}

      <CollapsibleSection
        id="recovery.today"
        label={todayLabel}
        actions={<UnverifiedChip unconfirmed={unconfirmed} total={active.length} onClick={onGoToTray} />}
      >
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {groups.map((g) => (
            <Tile
              key={g.group}
              label={GROUP_LABEL[g.group]}
              value={g.state === 'ready' ? 'Ready' : formatHours(g.hoursToReady).replace(/^in/, 'In')}
              tone={STATE_TONE[g.state]}
              size="lg"
              hint={
                g.state === 'ready'
                  ? g.value > 0.005
                    ? MUSCLE_LABEL[g.limiting] + ' at ' + Math.round(g.value * 100) + '%'
                    : 'fully fresh'
                  : 'waiting on ' + MUSCLE_LABEL[g.limiting].toLowerCase()
              }
            />
          ))}
        </div>
        <p className="mt-2 px-1 text-xs text-faint">
          A group is ready when its main movers are: chest, shoulders and triceps for push; back, lats and biceps
          for pull; quads, hamstrings and glutes for legs; abs, obliques and lower back for core.
        </p>
      </CollapsibleSection>

      <CollapsibleSection id="recovery.map" label="Fatigue map">
        <ChartCard
          title="Fatigue"
          subtitle={'As of ' + formatMoment(asOf) + (forecast === '0' ? '' : ', assuming no training until then')}
          actions={
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Toggle<Anchor>
                label="Fatigue as of"
                value={anchor}
                onChange={setAnchor}
                options={[
                  { value: 'now', label: 'Now' },
                  { value: 'last', label: 'Last session' },
                ]}
              />
              <Toggle<Forecast>
                label="Forecast"
                value={forecast}
                onChange={setForecast}
                options={[
                  { value: '0', label: '+0 h' },
                  { value: '24', label: '+24 h' },
                  { value: '48', label: '+48 h' },
                  { value: '72', label: '+72 h' },
                ]}
              />
            </div>
          }
          note={
            'Estimated from hard sets per muscle (secondary muscles count half), how close to failure they were ' +
            '(RPE, or estimated against your recent best), and the time since each session, with bigger muscles ' +
            'recovering more slowly. A heuristic, not a measurement: sleep, food and soreness are not in your export.' +
            (result.unmappedSets > 0
              ? ' ' + result.unmappedSets + ' recent sets name no muscle (tagged full-body or unknown) and are left out.'
              : '')
          }
        >
          <Suspense fallback={<div className="aspect-[2/1.6] w-full animate-pulse rounded-lg bg-sunken" />}>
            <BodyMap figure={data.settings.bodyFigure} regions={regions} selected={selected} onSelect={setSelected} />
          </Suspense>
          <FatigueLegend />
        </ChartCard>
      </CollapsibleSection>

      <CollapsibleSection id="recovery.muscles" label="By muscle">
        {active.length === 0 ? (
          <EmptyState>Nothing trained in the {FATIGUE_LOOKBACK_DAYS} days before {formatDate(asOf)}.</EmptyState>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {active.map((m) => (
              <li key={m.muscle}>
                <button
                  type="button"
                  aria-pressed={isHighlighted(m)}
                  onClick={() => setSelected(isHighlighted(m) ? null : (REGIONS_OF[m.muscle][0] ?? null))}
                  className={
                    'block w-full space-y-1.5 px-3 py-2.5 text-left ' +
                    (isHighlighted(m) ? 'bg-sunken' : 'hover:bg-sunken')
                  }
                >
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium text-ink">
                      {MUSCLE_LABEL[m.muscle]}
                      {m.unconfirmed && (
                        <span className="ml-1 text-xs text-warn" title="Rests on unconfirmed tags">
                          *
                        </span>
                      )}
                    </span>
                    <Badge tone={STATE_TONE[m.state]}>{STATE_LABEL[m.state]}</Badge>
                  </span>
                  <FatigueBar value={m.value} level={m.level} />
                  <span className="num block text-xs text-faint">
                    {Math.round(m.value * 100)}% · {m.hardSets7d.toFixed(1)} hard sets in 7 days · trained{' '}
                    {formatAgo(m.lastTrained, asOf)}
                    {m.state !== 'ready' && ' · ready ' + formatHours(m.hoursToReady)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {idle.length > 0 && active.length > 0 && (
          <p className="mt-3 text-xs text-faint">
            Untouched in the last {FATIGUE_LOOKBACK_DAYS} days: {idle.map((m) => MUSCLE_LABEL[m.muscle]).join(', ')}.
          </p>
        )}
      </CollapsibleSection>

      <CollapsibleSection id="recovery.volume" label="Weekly volume">
        <ChartCard
          title="Hard sets, last 7 days"
          subtitle={
            'Per muscle, to ' + formatMoment(anchorAt) + ', against the ' + WEEKLY_SETS_TARGET.low + '–' +
            WEEKLY_SETS_TARGET.high + ' sets a week commonly cited for muscle growth.'
          }
          note={
            'Weighted the same way as fatigue: a secondary muscle counts half a set and an easy set less than a hard ' +
            'one. Small muscles often get enough from compound lifts, so a short bar there is not automatically a gap. ' +
            'Only muscles trained in the last four weeks are listed. The band is a guide, not a rule.'
          }
        >
          <WeeklySetsChart rows={volume} />
        </ChartCard>
      </CollapsibleSection>

      <CollapsibleSection id="recovery.history" label="History" className="space-y-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Tile
            label={'Muscle-sessions, ' + HISTORY_DAYS + ' days'}
            value={history.muscleSessions}
            hint="a session that trained a muscle"
          />
          <Tile
            label="Went in fatigued"
            value={history.whileFatigued}
            tone={history.whileFatigued > 0 ? 'warn' : 'good'}
            hint={
              history.muscleSessions > 0
                ? Math.round((history.whileFatigued / history.muscleSessions) * 100) + '% of them'
                : undefined
            }
          />
          <Tile
            label="Most often"
            value={mostOverreached && mostOverreached.overreachCount > 0 ? MUSCLE_LABEL[mostOverreached.muscle] : 'None'}
            hint={
              mostOverreached && mostOverreached.overreachCount > 0
                ? mostOverreached.overreachCount + ' times trained while fatigued'
                : 'nothing trained before recovering'
            }
            className="col-span-2"
          />
        </div>
        <ChartCard
          title="Fatigue per day"
          subtitle={'Each cell is a muscle at the end of a day, over the ' + HISTORY_DAYS + ' days to ' + formatDate(anchorAt) + '.'}
          note="A dot is a training day; a ring is a session that started while the muscle was still fatigued (50% or more). Training while merely recovering is normal and not flagged."
        >
          <FatigueHistoryChart history={history} />
        </ChartCard>
      </CollapsibleSection>
    </div>
  );
}

function FatigueBar({ value, level }: { value: number; level: number }) {
  return (
    <span
      className="block h-1.5 w-full overflow-hidden rounded-full bg-sunken"
      role="meter"
      aria-valuenow={Math.round(value * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label="Fatigue"
    >
      <span
        className="block h-full rounded-full"
        style={{ width: Math.max(2, value * 100) + '%', background: FATIGUE[Math.max(1, level)] }}
      />
    </span>
  );
}

function RegionTip({ muscles, asOf }: { muscles: MuscleFatigue[]; asOf: Date }): ReactNode {
  return (
    <div className="space-y-1.5">
      {muscles.map((m) => (
        <div key={m.muscle}>
          <div className="flex items-center justify-between gap-3">
            <span className="font-semibold">{MUSCLE_LABEL[m.muscle]}</span>
            <span className="num">{Math.round(m.value * 100)}%</span>
          </div>
          <div className="text-dim">
            {STATE_LABEL[m.state]}
            {m.state !== 'ready' && ', ready ' + formatHours(m.hoursToReady)}
          </div>
          <div className="text-faint">Last trained {formatAgo(m.lastTrained, asOf)}</div>
        </div>
      ))}
    </div>
  );
}

function FatigueLegend() {
  const items: Array<[string, string[]]> = [
    ['Ready', [FATIGUE[0]]],
    ['Recovering', [FATIGUE[1], FATIGUE[2]]],
    ['Fatigued', [FATIGUE[3], FATIGUE[4]]],
  ];
  return (
    <div className="mt-4 flex flex-wrap justify-end gap-x-4 gap-y-1 text-xs text-dim">
      {items.map(([label, colors]) => (
        <span key={label} className="inline-flex items-center gap-1.5">
          <span className="inline-flex">
            {colors.map((c) => (
              <span key={c} className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />
            ))}
          </span>
          {label}
        </span>
      ))}
    </div>
  );
}
