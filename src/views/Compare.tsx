import { useMemo, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import {
  clearCompareCorpus,
  loadCompareCorpus,
  patchCompareCorpus,
  useCompareCorpus,
  type CompareScale,
} from '../store/compareCorpus';
import { parseCsv } from '../ingest/parseCsv';
import { buildMetaIndex } from '../meta/metaIndex';
import { guessMeta } from '../meta/guessMeta';
import { seedFor } from '../meta/seedMeta';
import { enrichSets } from '../model/effectiveLoad';
import { makeBodyweightResolver } from '../model/bodyweight';
import { compareCorpora, type Comparison, type Corpus, type Excluded } from '../derive/compare';
import type { ExerciseMeta } from '../model/types';
import { formatVolume, formatWeight } from '../format';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Notice,
  SectionLabel,
  Tile,
} from '../ui/primitives';
import { CsvDropzone } from '../ui/CsvDropzone';
import { Toggle } from '../charts/parts';

/**
 * Compare your training against another person's export.
 *
 * The tab's job is as much to refuse comparisons as to make them. Machine and
 * cable loads are not a shared unit between two gyms, bodyweight movements mean
 * nothing without both bodyweights, and a personal best is inflated by however
 * many attempts someone logged. What survives all that is a small core of
 * free-weight lifts -- 19 of 63 shared exercises on the reference data -- plus
 * everything about training SHAPE, which needs no normalisation at all.
 *
 * The second corpus lives in a module-level store rather than component state,
 * so it survives leaving the tab and coming back -- App unmounts the view on
 * every tab switch. It is still never persisted: it is somebody else's training
 * history, and a plain module variable means a reload clears it.
 */

export function Compare() {
  const data = useWorkoutData();
  const their = useCompareCorpus();
  const [error, setError] = useState<string | null>(null);

  const label = their?.label ?? 'Them';
  const kgInput = their?.bodyweightInput ?? '';
  const scale: CompareScale = their?.scale ?? 'absolute';

  const unit = data.settings.displayUnit;

  const readFile = async (file: File) => {
    setError(null);
    try {
      const text = await file.text();
      // Parse eagerly so a bad file is rejected here rather than blanking the tab.
      parseCsv(text, { filename: file.name, unit: data.settings.inputUnit });
      loadCompareCorpus({
        filename: file.name,
        text,
        label: 'Them',
        bodyweightInput: '',
        scale: 'absolute',
      });
    } catch (err) {
      clearCompareCorpus();
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * A GUESSED bodyweight is not a known one. With no entries recorded the
   * resolver hands back the configured default, which is fine for computing your
   * own history but would silently put a made-up number on both sides of a
   * comparison with another person. `isFallback` is the difference.
   */
  const yourKg = data.bodyweightAt.isFallback ? null : data.bodyweightAt(new Date());

  const comparison = useMemo((): Comparison | null => {
    if (data.current === null || their === null) return null;

    const parsed = parseCsv(their.text, { unit: data.settings.inputUnit });

    /**
     * Corpus B gets its OWN metadata, for two reasons.
     *
     * Correctness: handing it the store's `metaIndex` would send their unknown
     * exercise names down the lazy path, which calls `guessMeta` with no
     * observed-weights hint, so a bodyweight-only movement resolves to `external`
     * and computes to zero load.
     *
     * And ownership: another person's exercises have no business in your
     * persisted tag table or your tagging tray. Their vocabulary is not yours to
     * curate, so this map is built here and thrown away with the tab.
     */
    const observed = new Map<string, { anyNonZero: boolean; anySeconds: boolean; anyDistance: boolean }>();
    for (const s of parsed.sets) {
      const o = observed.get(s.exerciseName) ?? {
        anyNonZero: false,
        anySeconds: false,
        anyDistance: false,
      };
      if ((s.weightKg ?? 0) > 0) o.anyNonZero = true;
      if ((s.seconds ?? 0) > 0) o.anySeconds = true;
      if ((s.distanceRaw ?? 0) > 0) o.anyDistance = true;
      observed.set(s.exerciseName, o);
    }
    const theirMeta: Record<string, ExerciseMeta> = {};
    for (const [name, o] of observed) {
      theirMeta[name] = seedFor(name) ?? guessMeta(name, { observedWeights: o });
    }

    const kg = Number(kgInput.replace(',', '.'));
    const bodyweightKg = Number.isFinite(kg) && kg > 0 ? kg : null;

    const theirCorpus: Corpus = {
      label: label.trim() || 'Them',
      // Note: set and workout ids are content hashes of date + name, so two
      // people who trained the same evening collide. The two arrays are never
      // pooled or keyed together, which is what keeps that harmless.
      sets: enrichSets(
        parsed.sets,
        buildMetaIndex(theirMeta),
        makeBodyweightResolver([], bodyweightKg),
      ),
      meta: (n: string) => theirMeta[n],
      bodyweightKg,
    };

    const yourCorpus: Corpus = {
      label: 'You',
      sets: data.sets,
      meta: (n: string) => data.meta[n],
      bodyweightKg: yourKg,
    };

    return compareCorpora(yourCorpus, theirCorpus);
  }, [data.current, data.sets, data.meta, data.settings.inputUnit, their, kgInput, label, yourKg]);

  if (data.current === null) {
    return (
      <EmptyState title="Nothing imported yet">
        Import your own CSV first, then you have something to compare against.
      </EmptyState>
    );
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionLabel>Their export</SectionLabel>
        <CsvDropzone
          onFile={(f) => void readFile(f)}
          compact
          title={their ? their.filename : "Drop the other person's Strong CSV here"}
          subtitle={
            their
              ? 'Stays loaded while you move around the app. Drop another file to replace it.'
              : 'or click to choose a file · never saved, and gone when you reload the page'
          }
        />

        {error && (
          <Notice tone="danger" title="Could not read that file">
            {error}
          </Notice>
        )}

        {their && (
          <Card>
            <div className="flex flex-wrap items-end gap-4">
              <Field label="Their name" className="w-44">
                <Input
                  value={label}
                  onChange={(e) => patchCompareCorpus({ label: e.target.value })}
                  placeholder="Them"
                />
              </Field>
              {/* No `hint` here: it would render below the input and make this
                  field taller than the one beside it, which `items-end` then
                  resolves by pushing this input up. The explanation lives under
                  the whole row instead. */}
              <Field label="Their bodyweight (kg)" className="w-44">
                <Input
                  type="number"
                  step="0.1"
                  value={kgInput}
                  onChange={(e) => patchCompareCorpus({ bodyweightInput: e.target.value })}
                  placeholder="e.g. 78"
                />
              </Field>
              {/* A plain div, not a Field: Field renders a <label>, and a
                  <label> cannot be meaningfully bound to a <button>. The caption
                  is therefore decorative, which is why the button carries its
                  own aria-label. */}
              <div>
                <span className="hud-label mb-1 block">Their CSV</span>
                <Button
                  variant="danger"
                  aria-label="Remove their CSV"
                  onClick={() => {
                    clearCompareCorpus();
                    setError(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            </div>
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-faint">
              Bodyweight is needed for pull ups, dips and push ups &mdash; they are logged at
              zero load, so their real effort is the lifter&rsquo;s own body.
            </p>
          </Card>
        )}
      </section>

      {comparison && (
        <Results
          c={comparison}
          unit={unit}
          scale={scale}
          onScale={(next) => patchCompareCorpus({ scale: next })}
          yourKg={yourKg}
        />
      )}
    </div>
  );
}

const EXCLUDED_COPY: Record<Excluded, string> = {
  'machine-or-cable':
    'Machine and cable loads are not a shared unit. 60 kg on one manufacturer’s stack is not 60 kg on another’s, and a cable’s label depends on the pulley ratio.',
  'unknown-equipment':
    'The export does not say what equipment these use, so whether the load is comparable cannot be checked. Strong only states it in a trailing parenthetical.',
  'needs-bodyweight':
    'These are bodyweight movements. The load is the lifter’s own body, so both bodyweights are needed before the numbers mean the same thing.',
  'not-enough-history':
    'Fewer than three sessions with a usable estimate on one side or the other.',
};

const EXCLUDED_TITLE: Record<Excluded, string> = {
  'machine-or-cable': 'Not comparable across gyms',
  'unknown-equipment': 'Equipment not stated',
  'needs-bodyweight': 'Needs both bodyweights',
  'not-enough-history': 'Not enough shared history',
};

function Results({
  c,
  unit,
  scale,
  onScale,
  yourKg,
}: {
  c: Comparison;
  unit: 'kg' | 'lb';
  scale: 'absolute' | 'relative';
  onScale: (s: 'absolute' | 'relative') => void;
  yourKg: number | null;
}) {
  const them = c.them.label;
  const byReason = new Map<Excluded, string[]>();
  for (const e of c.excluded) {
    const list = byReason.get(e.reason);
    if (list) list.push(e.name);
    else byReason.set(e.reason, [e.name]);
  }

  return (
    <>
      <section>
        <SectionLabel>What can actually be compared</SectionLabel>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Lifts compared" value={c.lifts.length} size="lg" tone="accent" />
          <Tile label="Shared, not comparable" value={c.excluded.length} hint="see below" />
          <Tile label="Only you" value={c.yoursOnly.length} />
          <Tile label={'Only ' + them} value={c.theirsOnly.length} />
        </div>
        <p className="mt-3 max-w-2xl text-xs leading-relaxed text-dim">
          You share <span className="num text-ink">{c.sharedNames.length}</span> exercises, of
          which <span className="num text-ink">{c.lifts.length}</span> carry enough history on
          both sides in a form where load means the same thing in two different gyms. The rest
          are listed below with the reason, rather than quietly folded into an average.
        </p>
      </section>

      {!c.bodyweightKnown && (
        <Notice tone="warn" title="Bodyweight movements are being left out.">
          Pull ups, dips and push ups are logged at zero load, so their real effort is the
          lifter&rsquo;s own body. Fill in {them}&rsquo;s bodyweight above
          {yourKg === null && ' and record your own in Settings'} to bring them in.
        </Notice>
      )}

      {c.lifts.length > 0 && (
        <section className="space-y-3">
          <SectionLabel
            actions={
              <Toggle
                value={scale}
                onChange={onScale}
                label="Scale"
                options={[
                  { value: 'absolute', label: 'Absolute' },
                  { value: 'relative', label: 'Per kg bodyweight' },
                ]}
              />
            }
          >
            Shared lifts
          </SectionLabel>
          <p className="-mt-1 max-w-2xl text-xs leading-relaxed text-dim">
            The headline is each side&rsquo;s <strong className="text-ink">typical top set</strong>
            {' '}&mdash; the median of their best set per session. A personal best is a maximum
            over a sample, so it climbs with the number of attempts logged rather than with
            strength; the PR column is there for context and carries its session count.
          </p>
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
                <thead className="bg-sunken">
                  <tr>
                    <Th>Lift</Th>
                    <Th align="right">You</Th>
                    <Th align="right">{them}</Th>
                    <Th align="right">Ratio</Th>
                    <Th align="right">Best (sessions)</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.lifts.map((l) => {
                    const ratio = scale === 'relative' ? l.relativeRatio : l.ratio;
                    return (
                      <tr key={l.name}>
                        <td className="px-3 py-2 text-ink">{l.name}</td>
                        <td className="num px-3 py-2 text-right text-ink">
                          {formatWeight(l.youKg, unit)}
                        </td>
                        <td className="num px-3 py-2 text-right text-ink">
                          {formatWeight(l.themKg, unit)}
                        </td>
                        <td className="num px-3 py-2 text-right">
                          {ratio === null ? (
                            <span className="text-faint">&mdash;</span>
                          ) : (
                            <Badge tone={ratio > 1.05 ? 'warn' : ratio < 0.95 ? 'good' : 'neutral'}>
                              {ratio.toFixed(2)}&times;
                            </Badge>
                          )}
                        </td>
                        <td className="num px-3 py-2 text-right text-dim">
                          {formatWeight(l.youPeakKg, unit)} ({l.youSessions}) &middot;{' '}
                          {formatWeight(l.themPeakKg, unit)} ({l.themSessions})
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {scale === 'relative' && !c.bodyweightKnown && (
            <p className="text-xs text-warn">
              Per-kg figures need both bodyweights, so this column is empty until they are set.
            </p>
          )}
        </section>
      )}

      <section className="space-y-3">
        <SectionLabel>What was left out, and why</SectionLabel>
        <div className="grid gap-3 lg:grid-cols-2">
          {[...byReason.entries()].map(([reason, names]) => (
            <Card key={reason} title={EXCLUDED_TITLE[reason] + ' (' + names.length + ')'}>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-dim">
                {EXCLUDED_COPY[reason]}
              </p>
              <p className="mt-2 text-xs text-faint">{names.join(', ')}</p>
            </Card>
          ))}
        </div>
      </section>

      {c.slopes.length > 0 && (
        <section className="space-y-3">
          <SectionLabel>Who is moving faster</SectionLabel>
          <p className="-mt-1 max-w-2xl text-xs leading-relaxed text-dim">
            Rate of change is the fairest cross-person number: it does not care who started
            stronger. Comparing {c.slopes.length} lifts is {c.slopes.length} tests, so only
            differences that survive a correction for that are marked as real.
          </p>
          <Card padded={false}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
                <thead className="bg-sunken">
                  <tr>
                    <Th>Lift</Th>
                    <Th align="right">You</Th>
                    <Th align="right">{them}</Th>
                    <Th>&nbsp;</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.slopes.map((s) => (
                    <tr key={s.name}>
                      <td className="px-3 py-2 text-ink">{s.name}</td>
                      <td className="num px-3 py-2 text-right text-ink">
                        {s.youKgPerMonth >= 0 ? '+' : ''}
                        {s.youKgPerMonth.toFixed(1)} kg/mo
                      </td>
                      <td className="num px-3 py-2 text-right text-ink">
                        {s.themKgPerMonth >= 0 ? '+' : ''}
                        {s.themKgPerMonth.toFixed(1)} kg/mo
                      </td>
                      <td className="px-3 py-2">
                        {s.significant ? (
                          <Badge tone="warn">real difference</Badge>
                        ) : (
                          <span className="text-xs text-faint">within noise</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}

      <section className="space-y-3">
        <SectionLabel>How you each train</SectionLabel>
        <p className="-mt-1 max-w-2xl text-xs leading-relaxed text-dim">
          All rates rather than totals, so a longer history does not simply win. None of this
          needs normalising between two people.
        </p>
        <div className="grid gap-3 lg:grid-cols-2">
          <ShapeCard shape={c.you} unit={unit} />
          <ShapeCard shape={c.them} unit={unit} />
        </div>
      </section>

      {c.theyDoYouDont.length > 0 && (
        <section className="space-y-3">
          <SectionLabel>What {them} trains and you don&rsquo;t</SectionLabel>
          <Card>
            <p className="max-w-2xl text-xs leading-relaxed text-dim">
              Movements they do regularly with no counterpart anywhere in your history. This is
              the one comparison that needs no normalisation of any kind.
            </p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {c.theyDoYouDont.map((x) => (
                <li key={x.name}>
                  <Badge tone="accent">
                    {x.name} <span className="num text-faint">&middot; {x.sessions}</span>
                  </Badge>
                </li>
              ))}
            </ul>
          </Card>
        </section>
      )}
    </>
  );
}

function ShapeCard({
  shape,
  unit,
}: {
  shape: Comparison['you'];
  unit: 'kg' | 'lb';
}) {
  return (
    <Card title={shape.label} rail>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <Row label="Sessions / week" value={shape.sessionsPerWeek.toFixed(2)} />
        <Row label="Sets / session" value={shape.setsPerSession.toFixed(1)} />
        <Row label="Volume / week" value={formatVolume(shape.volumePerWeekKg, unit)} />
        <Row label="Sessions logged" value={String(shape.sessions)} />
      </dl>
      {shape.muscleShare.length > 0 && (
        <>
          <p className="hud-label mt-4">Volume by muscle</p>
          <ul className="mt-1 space-y-1">
            {shape.muscleShare.slice(0, 6).map((m) => (
              <li key={m.group} className="flex items-center gap-2 text-xs">
                <span className="w-20 shrink-0 text-dim">{m.group}</span>
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: (m.share * 100).toFixed(1) + '%' }}
                  />
                </span>
                <span className="num w-9 shrink-0 text-right text-ink">
                  {Math.round(m.share * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="hud-label">{label}</dt>
      <dd className="num text-ink">{value}</dd>
    </div>
  );
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th
      scope="col"
      className={
        'hud-label bg-sunken px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--c-border)] ' +
        (align === 'right' ? 'text-right' : 'text-left')
      }
    >
      {children}
    </th>
  );
}
