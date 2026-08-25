import { useWorkoutData } from '../store/useWorkoutData';
import { useAnalytics } from '../store/useAnalytics';
import type { Finding, FindingFamily, FindingSet } from '../derive/insights';
import { Badge, Card, EmptyState, Notice, SectionLabel, Tile } from '../ui/primitives';
import { UnverifiedChip } from '../charts/parts';
import { Sparkline, WeekdayBars } from '../viz/Insights';

/**
 * What to work on, ranked.
 *
 * The tab's credibility rests on what it does NOT say, so the counts of
 * suppressed and passed tests are rendered as prominently as the findings
 * themselves. A weakness engine that only ever shows weaknesses gives no way to
 * tell a real pattern from a search over enough patterns.
 */

const FAMILY_LABEL: Record<FindingFamily, string> = {
  consistency: 'Consistency',
  progression: 'Progression',
  neglect: 'Neglect and balance',
};

const FAMILY_BLURB: Record<FindingFamily, string> = {
  consistency: 'How reliably the training actually happens.',
  progression: 'Lifts that are not moving, measured against their own history.',
  neglect: 'Work that has quietly fallen out of the rotation.',
};

const FAMILY_ORDER: FindingFamily[] = ['consistency', 'progression', 'neglect'];

export function Improvements({ onSelectExercise }: { onSelectExercise?: (name: string) => void }) {
  const data = useWorkoutData();
  const a = useAnalytics({ granularity: 'week', groupBy: 'muscle' });
  const insights = a.insights;

  if (data.current === null) {
    return <EmptyState title="Nothing imported yet">Import a CSV to see what to work on.</EmptyState>;
  }

  const clear = insights.findings.filter((f) => f.confidence === 'clear');
  const suggestive = insights.findings.filter((f) => f.confidence === 'suggestive');

  return (
    <div className="space-y-8">
      <section>
        <SectionLabel
          actions={
            <UnverifiedChip
              unconfirmed={a.unconfirmedSets}
              total={a.sets.length}
              onClick={undefined}
            />
          }
        >
          What the data supports
        </SectionLabel>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Clear findings" value={clear.length} size="lg" tone="accent" />
          <Tile label="Suggestive" value={suggestive.length} hint="weaker evidence" />
          <Tile label="Patterns tested" value={insights.testsRun} />
          <Tile
            label="Below the noise floor"
            value={insights.suppressed}
            hint="tested, too weak to report"
          />
        </div>
      </section>

      {insights.findings.length === 0 && (
        <Notice tone="good" title="Nothing stands out.">
          {insights.testsRun > 0
            ? insights.testsRun +
              ' patterns were tested and none of them cleared the evidence bar. That is a ' +
              'result, not an absence of one.'
            : 'There is not enough history yet to test anything meaningful.'}
        </Notice>
      )}

      {FAMILY_ORDER.map((family) => {
        const inFamily = insights.findings.filter((f) => f.family === family);
        if (inFamily.length === 0) return null;
        return (
          <section key={family} className="space-y-3">
            <SectionLabel>{FAMILY_LABEL[family]}</SectionLabel>
            <p className="-mt-1 text-xs text-dim">{FAMILY_BLURB[family]}</p>
            <div className="space-y-3">
              {inFamily.map((f) => (
                <FindingCard
                  key={f.id}
                  finding={f}
                  weekStartsOn={data.settings.weekStartsOn}
                  onSelectExercise={onSelectExercise}
                />
              ))}
            </div>
          </section>
        );
      })}

      <Methodology insights={insights} />
    </div>
  );
}

function FindingCard({
  finding: f,
  weekStartsOn,
  onSelectExercise,
}: {
  finding: Finding;
  weekStartsOn: 0 | 1;
  onSelectExercise?: (name: string) => void;
}) {
  const clickable = f.subject !== undefined && onSelectExercise !== undefined;
  return (
    <Card rail={f.confidence === 'clear'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">
            {clickable ? (
              <button
                type="button"
                className="text-left hover:text-accent-ink"
                onClick={() => onSelectExercise?.(f.subject as string)}
              >
                {f.title}
              </button>
            ) : (
              f.title
            )}
          </h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">{f.detail}</p>
        </div>
        <Badge tone={f.confidence === 'clear' ? 'warn' : 'neutral'}>
          {f.confidence === 'clear' ? 'clear' : 'suggestive'}
        </Badge>
      </div>

      {f.chart && (
        <div className="mt-3">
          {f.chart.type === 'weekday' ? (
            <WeekdayBars
              rates={f.chart.rates}
              overall={f.chart.overall}
              flagged={f.chart.flagged}
              weekStartsOn={weekStartsOn}
            />
          ) : (
            <Sparkline
              values={f.chart.values}
              trend={f.chart.trend ?? undefined}
              label={f.title}
            />
          )}
        </div>
      )}

      <Evidence finding={f} />
    </Card>
  );
}

/**
 * The arithmetic behind the claim, stated plainly.
 *
 * A finding the reader cannot audit is an assertion. `z` and the family size are
 * shown because together they are the whole argument: a z of 2.7 means one thing
 * on its own and another as the best of thirty-four tries.
 */
function Evidence({ finding: f }: { finding: Finding }) {
  const e = f.evidence;
  return (
    <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line pt-2 text-xs">
      {e.z === null ? (
        <div className="flex gap-1.5">
          <dt className="text-faint">basis</dt>
          <dd className="text-dim">measured directly, not inferred</dd>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5">
            <dt className="text-faint">strength</dt>
            <dd className="num text-ink">{Math.abs(e.z).toFixed(1)}&sigma;</dd>
          </div>
          <div className="flex gap-1.5">
            <dt className="text-faint">tested against</dt>
            <dd className="num text-ink">
              {e.familySize} {e.familySize === 1 ? 'pattern' : 'patterns'}
            </dd>
          </div>
        </>
      )}
      <div className="flex gap-1.5">
        <dt className="text-faint">sample</dt>
        <dd className="num text-ink">{e.n}</dd>
      </div>
    </dl>
  );
}

/** Why the tab is quiet where it is quiet. */
function Methodology({ insights }: { insights: FindingSet }) {
  const skipped = [...new Set(insights.skippedRules)];
  return (
    <section className="space-y-3">
      <SectionLabel>How this was decided</SectionLabel>
      <Card>
        <p className="max-w-2xl text-xs leading-relaxed text-dim">
          Searching enough patterns guarantees finding one. Of{' '}
          <span className="num text-ink">{insights.testsRun}</span> patterns tested,{' '}
          <span className="num text-ink">{insights.suppressed}</span> were too weak to
          distinguish from chance and are not shown, and{' '}
          <span className="num text-ink">{insights.notAdverse}</span> came back with nothing
          wrong. A finding is marked <strong className="text-ink">clear</strong> only if it
          survives a correction for how many patterns were searched alongside it;{' '}
          <strong className="text-ink">suggestive</strong> ones clear the ordinary bar but not
          that one, and are worth a look rather than an action.
        </p>
        {skipped.length > 0 && (
          <p className="mt-2 max-w-2xl text-xs leading-relaxed text-dim">
            Not enough data to run: <span className="text-ink">{skipped.join(', ')}</span>.
          </p>
        )}
      </Card>
    </section>
  );
}
