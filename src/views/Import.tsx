import { useCallback, useRef, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { formatDate, formatDuration } from '../format';

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: 'warn' | 'bad' | 'good' }) {
  const toneClass =
    tone === 'bad'
      ? 'text-red-700'
      : tone === 'warn'
        ? 'text-amber-700'
        : tone === 'good'
          ? 'text-emerald-700'
          : 'text-slate-900';
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className={'text-lg font-semibold tabular-nums ' + toneClass}>{value}</div>
    </div>
  );
}

export function Import() {
  const data = useWorkoutData();
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="space-y-6">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const file = e.dataTransfer.files[0];
          if (file) void handleFile(file);
        }}
        onClick={() => inputRef.current?.click()}
        className={
          'cursor-pointer rounded-lg border-2 border-dashed px-6 py-10 text-center transition ' +
          (dragging ? 'border-sky-500 bg-sky-50' : 'border-slate-300 bg-slate-50 hover:bg-slate-100')
        }
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <p className="text-base font-medium text-slate-700">
          {busy ? 'Importing...' : 'Drop your Strong CSV export here'}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          Importing replaces the current history entirely. The previous import is archived.
        </p>
      </div>

      {error && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">Import failed</p>
          <p className="mt-1 whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {data.parseError && (
        <div className="rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-semibold">The stored import could not be parsed</p>
          <p className="mt-1 whitespace-pre-wrap">{data.parseError}</p>
        </div>
      )}

      {hasImport && !data.parseError && (
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Import report</h2>
            <p className="text-sm text-slate-500">
              {data.current?.filename} &middot; imported {formatDate(new Date(data.current?.importedAt ?? 0))}{' '}
              &middot; delimiter <code className="rounded bg-slate-100 px-1">{r.delimiter === '\t' ? 'tab' : r.delimiter}</code>
              {!r.delimiterConfident && <span className="text-amber-700"> (low confidence)</span>} &middot; weight read as{' '}
              {r.unit} <span className="text-slate-400">({r.unitSource === 'header' ? 'from header' : 'from settings'})</span>
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            <Stat label="Rows read" value={r.rowsRead.toLocaleString()} />
            <Stat label="Sets parsed" value={r.setsParsed.toLocaleString()} />
            <Stat label="Working sets" value={r.workingSets.toLocaleString()} />
            <Stat label="Warm-ups" value={r.warmupSets.toLocaleString()} />
            <Stat label="Drop sets" value={r.dropSets.toLocaleString()} />
            <Stat label="Rest rows collapsed" value={r.restRowsCollapsed.toLocaleString()} />
            <Stat label="Workouts" value={r.workoutCount.toLocaleString()} />
            <Stat label="Distinct exercises" value={r.exerciseNames.length.toLocaleString()} />
            <Stat
              label="Unknown tokens"
              value={r.unknownTokens.length}
              tone={r.unknownTokens.length > 0 ? 'bad' : 'good'}
            />
            <Stat
              label="Sets blocked from volume"
              value={blocked.toLocaleString()}
              tone={blocked > 0 ? 'warn' : 'good'}
            />
            <Stat
              label="Sets with unconfirmed tags"
              value={unconfirmedSets.toLocaleString()}
              tone={unconfirmedSets > 0 ? 'warn' : 'good'}
            />
            <Stat
              label="Date range"
              value={
                r.dateRange ? formatDate(r.dateRange.from) + ' - ' + formatDate(r.dateRange.to) : '-'
              }
            />
          </div>

          <details className="rounded border border-slate-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">
              Parser details and anomalies
            </summary>
            <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
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
              <Row label="Sets with load but zero reps" value={r.zeroRepSets} warn={r.zeroRepSets > 0} />
              <Row label="Rows with a distance value" value={r.distanceRows} />
              <Row label="Date parse failures" value={r.dateParseFailures} warn={r.dateParseFailures > 0} />
              <Row
                label="Headers not recognised"
                value={r.headersUnrecognised.length}
                warn={r.headersUnrecognised.length > 0}
              />
            </dl>

            {r.trimmedNames.length > 0 && (
              <div className="mt-3 rounded bg-amber-50 p-2 text-amber-900">
                <p className="font-medium">Exercise names with stray whitespace (trimmed):</p>
                <ul className="mt-1 list-inside list-disc">
                  {r.trimmedNames.map((n) => (
                    <li key={n}>
                      <code className="rounded bg-white px-1">[{n}]</code>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {r.nameCollisions.length > 0 && (
              <div className="mt-3 rounded bg-red-50 p-2 text-red-900">
                <p className="font-medium">
                  Trimming merged two different raw names into one. Check these:
                </p>
                <ul className="mt-1 list-inside list-disc">
                  {r.nameCollisions.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </div>
            )}

            {r.distanceRows > 0 && (
              <p className="mt-3 rounded bg-slate-50 p-2 text-slate-600">
                Distance values are stored raw and excluded from every metric: Strong does not
                record which unit they are in, and this export&apos;s running distances look like
                kilometres despite the metric setting claiming metres.
              </p>
            )}
          </details>

          {r.unknownTokens.length > 0 && (
            <div className="rounded border border-red-300 bg-red-50 p-4 text-sm">
              <p className="font-semibold text-red-900">
                {r.unknownTokens.length} row(s) had a set-order value we do not recognise. They were
                NOT imported.
              </p>
              <table className="mt-2 w-full text-left">
                <thead className="text-xs uppercase text-red-800">
                  <tr>
                    <th className="py-1">Line</th>
                    <th>Value</th>
                    <th>Exercise</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {r.unknownTokens.slice(0, 50).map((t, i) => (
                    <tr key={i} className="border-t border-red-200">
                      <td className="py-1">{t.line}</td>
                      <td>
                        <code className="rounded bg-white px-1">{t.raw}</code>
                      </td>
                      <td>{t.exerciseName}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.workouts.length > 0 && (
            <details className="rounded border border-slate-200 bg-white p-4 text-sm">
              <summary className="cursor-pointer font-medium text-slate-700">
                Most recent workouts
              </summary>
              <ul className="mt-2 divide-y divide-slate-100">
                {[...data.workouts]
                  .sort((a, b) => b.date.getTime() - a.date.getTime())
                  .slice(0, 10)
                  .map((w) => (
                    <li key={w.id} className="flex justify-between py-1">
                      <span>
                        {formatDate(w.date)} &middot; {w.name}
                      </span>
                      <span className="text-slate-500 tabular-nums">
                        {w.setIds.length} sets &middot; {formatDuration(w.durationSec)}
                      </span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-4 border-b border-slate-100 py-0.5">
      <dt className="text-slate-600">{label}</dt>
      <dd className={'tabular-nums ' + (warn ? 'font-semibold text-amber-700' : 'text-slate-900')}>
        {value.toLocaleString()}
      </dd>
    </div>
  );
}
