import { useMemo, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import {
  clearCompareImport,
  clearComparePerson,
  getComparePerson,
  patchComparePerson,
  setCompareImport,
  useComparePerson,
} from '../store/comparePerson';
import { parseCsv, type ParseResult } from '../ingest/parseCsv';
import { emptyReport } from '../ingest/report';
import { buildMetaIndex } from '../meta/metaIndex';
import { guessMeta } from '../meta/guessMeta';
import { seedFor } from '../meta/seedMeta';
import { enrichSets } from '../model/effectiveLoad';
import { makeBodyweightResolver } from '../model/bodyweight';
import { compareCorpora, type Comparison, type Corpus, type Excluded } from '../derive/compare';
import {
  comparisonToMarkdown,
  sharedLiftsToCsv,
  EXCLUDED_COPY,
  EXCLUDED_TITLE,
} from '../derive/compareReport';
import type { CompareScale, ExerciseMeta, WeightUnit } from '../model/types';
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
  Select,
  Tile,
} from '../ui/primitives';
import {
  PairedMuscleShare,
  PairedProgression,
  PairedRepBars,
  RatioBars,
  type ProgressionAlign,
} from '../viz/Pairs';
import { ChartCard } from '../charts/parts';
import { CsvDropzone } from '../ui/CsvDropzone';
import { downloadText, slugify } from '../ui/download';
import { BodyweightEditor } from './BodyweightEditor';
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
 * The second person lives in `store/comparePerson`, which persists them: their
 * export, their name and their bodyweight history come back after a reload. That
 * store's header explains the tradeoff. What is NOT persisted is their exercise
 * metadata -- built fresh below and thrown away with the tab, because their
 * vocabulary is not yours to curate.
 *
 * Their bodyweight is a full history rather than a single number, so their pull
 * ups resolve against what they weighed that month, exactly as yours do.
 */

const EMPTY_PARSE: ParseResult = { workouts: [], sets: [], report: emptyReport('', 0) };

export function Compare() {
  const data = useWorkoutData();
  const their = useComparePerson();
  const [dropError, setDropError] = useState<string | null>(null);
  /** Set when a new file landed on an existing person -- see the strip below. */
  const [kept, setKept] = useState<{ label: string; entries: number } | null>(null);

  const label = their?.label ?? '';
  const them = label.trim() === '' ? 'Them' : label.trim();
  /**
   * Keyed off `label`, not `them`: with no name at all `them` is "Them", and
   * "Remove Them's CSV" is worse than the neutral wording. Matches the `whose`
   * the bodyweight editor computes directly below these buttons.
   */
  const theirs = label.trim() === '' ? 'their' : them + '’s';
  const scale: CompareScale = their?.scale ?? 'absolute';
  const unit = data.settings.displayUnit;

  const readFile = async (file: File) => {
    setDropError(null);
    setKept(null);
    try {
      const text = await file.text();
      // Parse eagerly so a bad file is rejected here rather than blanking the
      // tab -- and rather than being written to disk.
      parseCsv(text, { filename: file.name, unit: data.settings.inputUnit });

      const before = getComparePerson();
      setCompareImport({
        text,
        filename: file.name,
        importedAt: Date.now(),
        // Stamped at drop time, exactly as your own imports are. Your input-unit
        // setting can change after this file is stored; reinterpreting their
        // whole history at 2.2x on a later reload would be silent and total.
        unit: data.settings.inputUnit,
      });
      if (before && (before.label.trim() !== '' || before.bodyweight.length > 0)) {
        setKept({ label: before.label, entries: before.bodyweight.length });
      }
    } catch (err) {
      setDropError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * M1 -- parse. Depends on their stored text and the unit it was stamped with,
   * never on the current setting.
   *
   * It must not throw. A file validated at drop time is not a validated file
   * three parser releases later, and now that it survives a reload, a throw here
   * would white-screen the tab on data the user cannot even see to delete.
   */
  const theirParse = useMemo((): { result: ParseResult; error: string | null } => {
    const f = their?.import;
    if (!f) return { result: EMPTY_PARSE, error: null };
    try {
      return {
        result: parseCsv(f.text, { filename: f.filename, unit: f.unit }),
        error: null,
      };
    } catch (err) {
      return { result: EMPTY_PARSE, error: err instanceof Error ? err.message : String(err) };
    }
  }, [their?.import]);

  /**
   * M2 -- their metadata. Corpus B gets its OWN, for two reasons.
   *
   * Correctness: handing it the store's `metaIndex` would send their unknown
   * exercise names down the lazy path, which calls `guessMeta` with no
   * observed-weights hint, so a bodyweight-only movement resolves to `external`
   * and computes to zero load.
   *
   * And ownership: another person's exercises have no business in your persisted
   * tag table or your tagging tray. This map is built here and thrown away with
   * the tab -- it is the one thing about them that is still never stored.
   */
  const theirMeta = useMemo((): Record<string, ExerciseMeta> => {
    const observed = new Map<
      string,
      { anyNonZero: boolean; anySeconds: boolean; anyDistance: boolean }
    >();
    for (const s of theirParse.result.sets) {
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
    const out: Record<string, ExerciseMeta> = {};
    for (const [name, o] of observed) {
      out[name] = seedFor(name) ?? guessMeta(name, { observedWeights: o });
    }
    return out;
  }, [theirParse.result.sets]);

  /**
   * A GUESSED bodyweight is not a known one. With no entries recorded your
   * resolver hands back the configured default, which is fine for computing your
   * own history but would silently put a made-up number on both sides of a
   * comparison with another person. `isFallback` is the difference.
   */
  const yourKg = data.bodyweightAt.isFallback ? null : data.bodyweightAt(new Date());

  /** Theirs has no fallback at all: unknown stays unknown, by construction. */
  const theirAt = useMemo(
    () => makeBodyweightResolver(their?.bodyweight ?? [], null),
    [their?.bodyweight],
  );
  const themKg = theirAt.isFallback ? null : theirAt(new Date());

  const theirSpan = theirParse.result.report.dateRange;

  const comparison = useMemo((): Comparison | null => {
    if (data.current === null || their?.import == null) return null;

    const theirCorpus: Corpus = {
      label: them,
      // Note: set and workout ids are content hashes of date + name, so two
      // people who trained the same evening collide. The two arrays are never
      // pooled or keyed together, which is what keeps that harmless.
      sets: enrichSets(theirParse.result.sets, buildMetaIndex(theirMeta), theirAt),
      meta: (n: string) => theirMeta[n],
      bodyweightKg: themKg,
    };

    const yourCorpus: Corpus = {
      label: 'You',
      sets: data.sets,
      meta: (n: string) => data.meta[n],
      bodyweightKg: yourKg,
    };

    return compareCorpora(yourCorpus, theirCorpus);
  }, [
    data.current,
    data.sets,
    data.meta,
    their?.import,
    theirParse.result.sets,
    theirMeta,
    theirAt,
    themKg,
    them,
    yourKg,
  ]);

  if (data.current === null) {
    return (
      <EmptyState title="Nothing imported yet">
        Import your own CSV first, then you have something to compare against.
      </EmptyState>
    );
  }

  const unitMismatch =
    their?.import != null && their.import.unit !== data.settings.inputUnit;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <SectionLabel>Their export</SectionLabel>
        <CsvDropzone
          onFile={(f) => void readFile(f)}
          compact
          title={their?.import ? their.import.filename : "Drop the other person's Strong CSV here"}
          subtitle={
            their?.import
              ? 'Saved on this device, so it is still here next time. Drop another file to replace it.'
              : 'or click to choose a file · stored in this browser only, never uploaded'
          }
        />

        {dropError && (
          <Notice tone="danger" title="Could not read that file">
            {dropError}
          </Notice>
        )}

        {theirParse.error && (
          <Notice tone="danger" title="Their stored export can no longer be read">
            <p>{theirParse.error}</p>
            <p className="mt-1">
              It parsed when it was dropped, so this is most likely a change in the importer. Drop
              the file again, or remove it below.
            </p>
          </Notice>
        )}

        {unitMismatch && their?.import && (
          <Notice tone="warn">
            Their export was read as <strong>{their.import.unit}</strong>, which differs from the
            input unit now selected. It is still being read as {their.import.unit} &mdash; drop it
            again to reinterpret it.
          </Notice>
        )}

        {kept && (
          <Notice tone="warn" title="Kept what was already here.">
            <p>
              {kept.label.trim() === '' ? 'The name' : kept.label} and{' '}
              <span className="num">{kept.entries}</span> bodyweight{' '}
              {kept.entries === 1 ? 'entry' : 'entries'} carried over onto the new file, on the
              assumption this is a fresher export from the same person.
            </p>
            <div className="mt-2">
              <Button
                size="sm"
                onClick={() => {
                  clearComparePerson();
                  setKept(null);
                }}
              >
                Not them &mdash; start fresh
              </Button>
            </div>
          </Notice>
        )}
      </section>

      <section className="space-y-3">
        <SectionLabel
          actions={
            their && (
              // Two separate deletions, because the two halves have separate
              // lives: a fresher export arrives without their weight changing,
              // and a bad measurements import should not cost them their CSV.
              // Both are destructive, so both are red.
              <div className="flex gap-2">
                {their.import && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      clearCompareImport();
                      setDropError(null);
                      setKept(null);
                    }}
                  >
                    Remove {theirs} CSV
                  </Button>
                )}
                {their.bodyweight.length > 0 && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => patchComparePerson({ bodyweight: [] })}
                  >
                    Remove {theirs} weights
                  </Button>
                )}
              </div>
            )
          }
        >
          Who you are comparing against
        </SectionLabel>

        <Card>
          <div className="max-w-xs">
            <Field label="Their name" hint="Only a label. Used everywhere below.">
              <Input
                value={label}
                onChange={(e) => patchComparePerson({ label: e.target.value })}
                placeholder="Them"
              />
            </Field>
          </div>

          <h3 className="mt-5 text-sm font-semibold text-ink">Their bodyweight</h3>
          <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">
            Pull ups, dips and push ups are logged at zero load, so their real effort is the
            lifter&rsquo;s own body and none of those movements can be compared without it. A dated
            history rather than one number, so their sets resolve against what they weighed at the
            time &mdash; the same way yours do.
          </p>
          <div className="mt-3">
            <BodyweightEditor
              entries={their?.bodyweight ?? []}
              onChange={(next) => patchComparePerson({ bodyweight: next })}
              span={theirSpan}
              unit={their?.import?.unit ?? data.settings.inputUnit}
              owner={label}
              spanHint={
                <Notice tone="warn" title="Drop their workout export first.">
                  Readings are clipped to the span their workouts cover, so there is nothing to clip
                  against yet. Entries typed by hand below work either way.
                </Notice>
              }
            />
          </div>
        </Card>
      </section>

      {comparison && (
        <Results
          c={comparison}
          unit={unit}
          scale={scale}
          onScale={(next) => patchComparePerson({ scale: next })}
          yourKg={yourKg}
          themKg={themKg}
          theirs={theirs}
        />
      )}
    </div>
  );
}

function Results({
  c,
  unit,
  scale,
  onScale,
  yourKg,
  themKg,
  theirs,
}: {
  c: Comparison;
  unit: WeightUnit;
  scale: CompareScale;
  onScale: (s: CompareScale) => void;
  yourKg: number | null;
  themKg: number | null;
  /** Possessive form of their name, or "their" when unnamed. */
  theirs: string;
}) {
  const them = c.them.label;
  const stem = slugify('you vs ' + them);
  const opts = { unit, scale, yourKg, themKg };
  const [align, setAlign] = useState<ProgressionAlign>('elapsed');
  /** Null means "the first one" -- the list is re-sorted on every scale change. */
  const [picked, setPicked] = useState<string | null>(null);
  const charted = c.lifts.find((l) => l.name === picked) ?? c.lifts[0] ?? null;
  const byReason = new Map<Excluded, string[]>();
  for (const e of c.excluded) {
    const list = byReason.get(e.reason);
    if (list) list.push(e.name);
    else byReason.set(e.reason, [e.name]);
  }

  return (
    <>
      <section>
        <SectionLabel
          actions={
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() =>
                  downloadText(
                    stem + '.md',
                    'text/markdown;charset=utf-8',
                    comparisonToMarkdown(c, opts),
                  )
                }
              >
                Export Markdown
              </Button>
              <Button
                size="sm"
                disabled={c.lifts.length === 0}
                onClick={() =>
                  downloadText(stem + '-lifts.csv', 'text/csv;charset=utf-8', sharedLiftsToCsv(c, opts))
                }
              >
                Export lifts CSV
              </Button>
            </div>
          }
        >
          What can actually be compared
        </SectionLabel>
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
          lifter&rsquo;s own body. Record {theirs} bodyweight above
          {yourKg === null && ' and your own in Settings'} to bring them in.
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
          <Card>
            <RatioBars
              lifts={c.lifts}
              scale={scale}
              youLabel="You"
              themLabel={them}
              unit={unit}
            />
          </Card>
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

      {charted && (
        <section className="space-y-3">
          <SectionLabel
            actions={
              <Toggle
                value={align}
                onChange={setAlign}
                label="Align"
                options={[
                  { value: 'elapsed', label: 'From each start' },
                  { value: 'calendar', label: 'By date' },
                ]}
              />
            }
          >
            Side by side, over time
          </SectionLabel>
          <ChartCard
            title={charted.name}
            subtitle="Best estimated 1RM per session"
            actions={
              c.lifts.length > 1 && (
                <Select
                  value={charted.name}
                  aria-label="Lift to chart"
                  onChange={(e) => setPicked(e.target.value)}
                  className="w-56"
                >
                  {c.lifts.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              )
            }
            note={
              align === 'elapsed'
                ? 'Weeks from each person’s own first session with this lift. Two people’s calendars rarely overlap, and on a shared date axis whoever started earlier is drawn as a long flat line beside a short steep one — which reads as a difference in progress rather than in start date.'
                : 'Real dates, so a shared training period lines up. Lines break across gaps longer than four weeks rather than inventing progress through them.'
            }
          >
            <PairedProgression
              lift={charted}
              youLabel="You"
              themLabel={them}
              unit={unit}
              align={align}
            />
          </ChartCard>
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
        <div className="grid gap-3 lg:grid-cols-2">
          <ChartCard
            title="Volume by muscle"
            subtitle="Share of resolvable volume"
            note="Their side runs entirely on guessed exercise tags. Yours can be corrected in the tagging tray; theirs has no such path, because their vocabulary is not yours to curate."
          >
            <PairedMuscleShare you={c.you} them={c.them} />
          </ChartCard>
          <ChartCard
            title="Rep distribution"
            subtitle="Share of working sets at each rep count"
            note="Share rather than count, so a longer history does not simply win. Not pre-binned into 1-5 / 6-12 / 13+: the multi-modality is the finding, and coarse bins erase it."
          >
            <PairedRepBars you={c.you} them={c.them} />
          </ChartCard>
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
