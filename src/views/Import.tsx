import { useCallback, useState, type ReactNode } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { formatDate, formatDuration } from '../format';
import { Badge, Card, Notice, SectionLabel, Tile, type Tone } from '../ui/primitives';
import { CsvDropzone } from '../ui/CsvDropzone';

export function Import() {
  const data = useWorkoutData();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleFile = useCallback(
    async (file: File) => {
      setError(null);
      setBusy(true);
      try {
        const text = await file.text();
        await data.importCsv(text, file.name);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [data],
  );

  const r = data.report;
  const hasImport = data.current !== null;
  const blocked = data.sets.filter((s) => s.effectiveLoadKg === null && !s.isUnloaded).length;
  const unconfirmedSets = data.sets.filter((s) => !s.metaConfirmed).length;

  const dropzone = (
    <CsvDropzone
      onFile={(f) => void handleFile(f)}
      busy={busy}
      compact={hasImport}
      title="Drop your Strong CSV export here"
      busyTitle="Reading your export..."
      subtitle="or click to choose a file · importing replaces the current history, and the previous import is archived"
    />
  );

  // --- the landing, before anything has been imported -------------------------
  if (!hasImport && !data.parseError) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="pb-8 pt-6 text-center sm:pt-12">
          <Badge tone="accent" dot className="mb-5">
            Nothing leaves this browser
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Every set you&rsquo;ve logged,
            <br />
            <span className="text-accent-ink">read properly.</span>
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-dim">
            StrongInsight turns a Strong CSV export into the analysis the app itself never shows
            you &mdash; real volume with bodyweight counted, split detection, balance, and how your
            training actually changed over time.
          </p>
        </div>

        {dropzone}

        {error && (
          <div className="mt-4">
            <Notice tone="danger" title="Import failed">
              <p className="whitespace-pre-wrap">{error}</p>
            </Notice>
          </div>
        )}

        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          <Step
            n="01"
            title="Export from Strong"
            body="Settings, then Export Data. Strong emails you a CSV."
          />
          <Step
            n="02"
            title="Drop it above"
            body="Parsed in-page. No upload, no account, no backend."
          />
          <Step
            n="03"
            title="Confirm the tags"
            body="Exercise metadata starts as a guess. The tray shows what still needs you."
          />
        </div>

        <p className="mt-8 text-center text-xs text-faint">
          No export handy? The repository ships a synthetic one at{' '}
          <code className="num rounded bg-sunken px-1 py-0.5 text-ink">
            fixtures/sample_workouts.csv
          </code>
          .
        </p>
      </div>
    );
  }

  // --- the ingest report, once something is loaded -----------------------------
  return (
    <div className="space-y-6">
      {dropzone}

      {error && (
        <Notice tone="danger" title="Import failed">
          <p className="whitespace-pre-wrap">{error}</p>
        </Notice>
      )}

      {data.parseError && (
        <Notice tone="danger" title="The stored import could not be parsed">
          <p className="whitespace-pre-wrap">{data.parseError}</p>
        </Notice>
      )}

      {hasImport && !data.parseError && (
        <div className="space-y-4">
          <SectionLabel>Import report</SectionLabel>

          <Card rail>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span className="font-semibold text-ink">{data.current?.filename}</span>
              <span className="text-faint">&middot;</span>
              <span className="text-dim">
                imported {formatDate(new Date(data.current?.importedAt ?? 0))}
              </span>
              <span className="text-faint">&middot;</span>
              <span className="text-dim">
                delimiter{' '}
                <code className="num rounded bg-sunken px-1 text-ink">
                  {r.delimiter === '\t' ? 'tab' : r.delimiter}
                </code>
              </span>
              {!r.delimiterConfident && <Badge tone="warn">low confidence</Badge>}
              <span className="text-faint">&middot;</span>
              <span className="text-dim">
                weight read as <span className="font-medium text-ink">{r.unit}</span>{' '}
                <span className="text-faint">
                  ({r.unitSource === 'header' ? 'from header' : 'from settings'})
                </span>
              </span>
            </div>
          </Card>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Tile label="Rows read" value={r.rowsRead.toLocaleString()} />
            <Tile label="Sets parsed" value={r.setsParsed.toLocaleString()} />
            <Tile label="Working sets" value={r.workingSets.toLocaleString()} />
            <Tile label="Warm-ups" value={r.warmupSets.toLocaleString()} />
            <Tile label="Drop sets" value={r.dropSets.toLocaleString()} />
            <Tile label="Rest rows collapsed" value={r.restRowsCollapsed.toLocaleString()} />
            <Tile label="Workouts" value={r.workoutCount.toLocaleString()} />
            <Tile label="Distinct exercises" value={r.exerciseNames.length.toLocaleString()} />
            <Tile
              label="Unknown tokens"
              value={r.unknownTokens.length}
              tone={tone(r.unknownTokens.length > 0, 'danger')}
            />
            <Tile
              label="Sets blocked from volume"
              value={blocked.toLocaleString()}
              tone={tone(blocked > 0, 'warn')}
            />
            <Tile
              label="Sets with unconfirmed tags"
              value={unconfirmedSets.toLocaleString()}
              tone={tone(unconfirmedSets > 0, 'warn')}
            />
            <Tile
              label="Date range"
              value={
                r.dateRange ? formatDate(r.dateRange.from) + ' - ' + formatDate(r.dateRange.to) : '-'
              }
              size="sm"
              className="flex flex-col justify-center"
            />
          </div>

          {r.unknownTokens.length > 0 && (
            <Notice
              tone="danger"
              title={
                r.unknownTokens.length +
                ' row(s) had a set-order value we do not recognise. They were NOT imported.'
              }
            >
              <div className="mt-2 overflow-x-auto rounded-md border border-danger-line">
                <table className="w-full text-left text-xs">
                  <thead className="bg-danger-bg">
                    <tr className="hud-label">
                      <th className="px-2 py-1.5 font-medium">Line</th>
                      <th className="px-2 py-1.5 font-medium">Value</th>
                      <th className="px-2 py-1.5 font-medium">Exercise</th>
                    </tr>
                  </thead>
                  <tbody className="num">
                    {r.unknownTokens.slice(0, 50).map((t, i) => (
                      <tr key={i} className="border-t border-danger-line">
                        <td className="px-2 py-1">{t.line}</td>
                        <td className="px-2 py-1">
                          <code className="rounded bg-surface px-1">{t.raw}</code>
                        </td>
                        <td className="px-2 py-1 font-sans">{t.exerciseName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Notice>
          )}

          <Disclosure summary="Parser details and anomalies">
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <Row label="Rest rows seen" value={r.restRowsSeen} />
              <Row label="Rest rows collapsed onto a set" value={r.restRowsCollapsed} />
              <Row
                label="Rest rows with no preceding set (dropped)"
                value={r.orphanRestRows}
                warn={r.orphanRestRows > 0}
              />
              <Row
                label="Rest rows overwriting an earlier value"
                value={r.duplicateRestRows}
                warn={r.duplicateRestRows > 0}
              />
              <Row
                label="Rest rows with no usable duration"
                value={r.malformedRestRows}
                warn={r.malformedRestRows > 0}
              />
              <Row label="Isometric sets (seconds logged)" value={r.isometricSets} />
              <Row
                label="Sets with load but zero reps"
                value={r.zeroRepSets}
                warn={r.zeroRepSets > 0}
              />
              <Row label="Rows with a distance value" value={r.distanceRows} />
              <Row
                label="Date parse failures"
                value={r.dateParseFailures}
                warn={r.dateParseFailures > 0}
              />
              <Row
                label="Headers not recognised"
                value={r.headersUnrecognised.length}
                warn={r.headersUnrecognised.length > 0}
              />
            </dl>

            {r.trimmedNames.length > 0 && (
              <div className="mt-4">
                <Notice tone="warn" title="Exercise names with stray whitespace (trimmed):">
                  <ul className="mt-1 flex flex-wrap gap-1.5">
                    {r.trimmedNames.map((n) => (
                      <li key={n}>
                        <code className="num rounded bg-surface px-1 py-0.5 text-ink">[{n}]</code>
                      </li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}

            {r.nameCollisions.length > 0 && (
              <div className="mt-3">
                <Notice
                  tone="danger"
                  title="Trimming merged two different raw names into one. Check these:"
                >
                  <ul className="mt-1 list-inside list-disc">
                    {r.nameCollisions.map((n) => (
                      <li key={n}>{n}</li>
                    ))}
                  </ul>
                </Notice>
              </div>
            )}

            {r.distanceRows > 0 && (
              <p className="mt-3 rounded-md bg-sunken p-2.5 text-xs leading-relaxed text-dim">
                Distance values are stored raw and excluded from every metric: Strong does not
                record which unit they are in, and this export&apos;s running distances look like
                kilometres despite the metric setting claiming metres.
              </p>
            )}
          </Disclosure>

          {data.workouts.length > 0 && (
            <Disclosure summary="Most recent workouts">
              <ul className="divide-y divide-line">
                {[...data.workouts]
                  .sort((a, b) => b.date.getTime() - a.date.getTime())
                  .slice(0, 10)
                  .map((w) => (
                    <li key={w.id} className="flex justify-between gap-4 py-1.5 text-sm">
                      <span className="text-ink">
                        <span className="num text-dim">{formatDate(w.date)}</span> &middot; {w.name}
                      </span>
                      <span className="num shrink-0 text-dim">
                        {w.setIds.length} sets &middot; {formatDuration(w.durationSec)}
                      </span>
                    </li>
                  ))}
              </ul>
            </Disclosure>
          )}
        </div>
      )}
    </div>
  );
}

function tone(active: boolean, t: Tone): Tone {
  return active ? t : 'good';
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <div className="num text-xs font-semibold text-accent-ink">{n}</div>
      <div className="mt-2 text-sm font-semibold text-ink">{title}</div>
      <p className="mt-1 text-xs leading-relaxed text-dim">{body}</p>
    </div>
  );
}

function Disclosure({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group overflow-hidden rounded-lg border border-line bg-surface">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-medium text-ink marker:content-['']">
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          className="text-faint transition-transform group-open:rotate-90"
        >
          <path d="M4.5 2.5 8 6l-3.5 3.5" />
        </svg>
        {summary}
      </summary>
      <div className="border-t border-line p-4 text-sm">{children}</div>
    </details>
  );
}

function Row({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-line py-1">
      <dt className="text-dim">{label}</dt>
      <dd className={'num ' + (warn ? 'font-semibold text-warn' : 'text-ink')}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
