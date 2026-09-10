import { useRef, useState, type ReactNode } from 'react';
import {
  parseBodyweightCsv,
  type BodyweightImportReport,
} from '../ingest/parseBodyweightCsv';
import { mergeBodyweight, removeBodyweight, upsertBodyweight } from '../model/bodyweight';
import type { BodyweightEntry, WeightUnit } from '../model/types';
import { formatDate } from '../format';
import { Button, Field, Input, Notice } from '../ui/primitives';

/**
 * A bodyweight history: import a measurements CSV, or type entries by hand.
 *
 * Extracted because two people now have one. Yours lives in Settings and
 * persists through `useWorkoutData`; theirs lives on the Compare tab and
 * persists through the compare store. This component knows about neither -- it
 * is fully controlled, and `onChange` always receives the complete next array,
 * because every bodyweight change re-enriches the whole corpus and a partial
 * update would mean two writes for one edit.
 *
 * Not in `src/ui/`: everything there imports only React and its siblings, and
 * this needs `ingest/` and `model/`. `views/` is where domain-aware React lives,
 * and not every file in it has to be a tab.
 *
 * Copy that differs between the two owners is a prop, for the reason
 * `ui/CsvDropzone.tsx` gives: anything that has to say different things in
 * different places is a prop, not a constant.
 */

/** The last import, pinned to the entries array it produced. See `fresh` below. */
type ImportOutcome = {
  forEntries: BodyweightEntry[];
  report: BodyweightImportReport | null;
  error: string | null;
};

export type BodyweightEditorProps = {
  entries: BodyweightEntry[];
  onChange: (next: BodyweightEntry[]) => void;
  /**
   * The training span readings are clipped to. Null disables the import: there
   * is nothing to clip against, and a measurements export typically reaches back
   * years before training started.
   */
  span: { from: Date; to: Date } | null;
  /** Fallback when the file carries no unit column and no unit header suffix. */
  unit: WeightUnit;
  /** Why `span` is null, in the caller's words. */
  spanHint?: ReactNode;
  /** Whose history this is. Empty means yours. */
  owner?: string;
};

export function BodyweightEditor({
  entries,
  onChange,
  span,
  unit,
  spanHint,
  owner,
}: BodyweightEditorProps) {
  const [newDate, setNewDate] = useState(formatDate(new Date()));
  const [newKg, setNewKg] = useState('');
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const whose = owner && owner.trim() !== '' ? owner.trim() + '’s' : 'your';
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));

  /**
   * An import report describes the history it produced. The moment that history
   * changes -- a row deleted here, or the whole list cleared from outside -- the
   * report is describing something that is no longer on screen, and leaving "5
   * entries imported" above an empty table is just wrong. Tying it to the array
   * it was computed for retires it automatically, with nothing to remember to
   * reset.
   */
  const fresh = outcome !== null && outcome.forEntries === entries ? outcome : null;

  const importCsv = async (file: File) => {
    setOutcome(null);
    try {
      const parsed = parseBodyweightCsv(await file.text(), {
        filename: file.name,
        unit,
        span,
      });
      // One write with the final array: each one re-enriches the whole corpus.
      // Nothing kept means nothing to write, and the report stands against the
      // history that is already there -- which is exactly what explains the zero.
      const next =
        parsed.entries.length > 0 ? mergeBodyweight(entries, parsed.entries) : entries;
      if (next !== entries) onChange(next);
      setOutcome({ forEntries: next, report: parsed.report, error: null });
    } catch (err) {
      setOutcome({
        forEntries: entries,
        report: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const addEntry = () => {
    const next = upsertBodyweight(entries, newDate, newKg);
    // Unchanged means the form did not describe a reading -- leave it alone.
    if (next === entries) return;
    onChange(next);
    setNewKg('');
  };

  return (
    <div>
      <div className="rounded-lg border border-line bg-sunken p-3">
        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!span} onClick={() => fileRef.current?.click()}>
            Import weight CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importCsv(f);
              // Reset so re-picking the same file fires onChange again.
              e.target.value = '';
            }}
          />
          <p className="text-xs text-dim">
            Strong&rsquo;s measurements export. Readings are clipped to {whose} training period, one
            per day, and range-checked.
          </p>
        </div>

        {!span && spanHint && <div className="mt-3">{spanHint}</div>}

        {fresh?.error != null && (
          <div className="mt-3">
            <Notice tone="danger" title="Could not read that file">
              {fresh.error}
            </Notice>
          </div>
        )}

        {fresh?.report != null && <BodyweightReport r={fresh.report} />}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Field label="Date" className="w-44">
          <Input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} />
        </Field>
        <Field label="Weight (kg)" className="w-32">
          <Input
            type="number"
            step="0.1"
            value={newKg}
            onChange={(e) => setNewKg(e.target.value)}
          />
        </Field>
        <Button variant="primary" className="mb-0.5" onClick={addEntry}>
          Add / update
        </Button>
      </div>

      {sorted.length > 0 && (
        <div className="mt-4 max-w-md overflow-hidden rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-sunken">
              <tr>
                <th className="hud-label px-3 py-2 font-medium">Date</th>
                <th className="hud-label px-3 py-2 text-right font-medium">kg</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sorted.map((e) => (
                <tr key={e.date}>
                  <td className="num px-3 py-1.5 text-ink">{e.date}</td>
                  <td className="px-3 py-1.5 text-right">
                    {/* Uncontrolled and committed on blur: a controlled input
                        bound to a parsed number eats the decimal point while
                        "78.5" is still being typed. */}
                    <Input
                      type="number"
                      step="0.1"
                      defaultValue={e.kg}
                      className="w-24 text-right"
                      onBlur={(ev) => {
                        const next = upsertBodyweight(entries, e.date, ev.target.value);
                        if (next !== entries) onChange(next);
                      }}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-danger"
                      onClick={() => onChange(removeBodyweight(entries, e.date))}
                    >
                      delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const REJECT_REASON: Record<string, string> = {
  'not-a-number': 'not a number',
  implausible: 'outside 30-300 kg',
  // Against the median of THIS FILE, not of any stored history -- see the
  // outlier pass in parseBodyweightCsv.
  outlier: 'more than 25% from the median of this file',
  'unknown-unit': 'unrecognised unit',
  'bad-date': 'unreadable date',
};

/**
 * The import's own accounting. Nothing is silently dropped -- every refused row
 * is listed with its file line and verbatim value, matching what the workout
 * import report does.
 */
function BodyweightReport({ r }: { r: BodyweightImportReport }) {
  const nothing = r.entriesKept === 0;
  return (
    <div className="mt-3 space-y-2 text-xs">
      <Notice
        tone={nothing ? 'warn' : 'good'}
        title={
          nothing
            ? 'Nothing was imported from ' + r.filename
            : r.entriesKept + ' entries imported from ' + r.filename
        }
      >
        <ul className="space-y-0.5">
          <li>
            <span className="num text-ink">{r.rowsRead}</span> rows read
            {r.dateRange && (
              <>
                {' '}
                &mdash; kept <span className="num text-ink">{r.dateRange.from}</span> to{' '}
                <span className="num text-ink">{r.dateRange.to}</span>
              </>
            )}
          </li>
          {r.outOfSpan > 0 && (
            <li>
              <span className="num text-ink">{r.outOfSpan}</span> outside the training period
            </li>
          )}
          {r.sameDayCollapsed > 0 && (
            <li>
              <span className="num text-ink">{r.sameDayCollapsed}</span> same-day readings
              collapsed, keeping the last of each day
            </li>
          )}
          {r.skippedTypes.map((t) => (
            <li key={t.type}>
              <span className="num text-ink">{t.count}</span> rows of &ldquo;{t.type}&rdquo; are not
              bodyweight
            </li>
          ))}
          {r.assumedSingleType && (
            <li className="text-warn">
              The measurement type in this file was not recognised, but it is the only one present
              and its values read as weights, so it was used.
            </li>
          )}
        </ul>
      </Notice>

      {r.rejected.length > 0 && (
        <Notice tone="warn" title={r.rejected.length + ' rows were refused'}>
          <table className="mt-1 w-full max-w-sm text-left">
            <thead>
              <tr>
                <th className="hud-label py-1 pr-3 font-medium">Line</th>
                <th className="hud-label py-1 pr-3 font-medium">Value</th>
                <th className="hud-label py-1 font-medium">Why</th>
              </tr>
            </thead>
            <tbody>
              {r.rejected.slice(0, 25).map((row) => (
                <tr key={row.line + ':' + row.reason}>
                  <td className="num py-0.5 pr-3">{row.line}</td>
                  <td className="num py-0.5 pr-3">{row.raw || '(empty)'}</td>
                  <td className="py-0.5">{REJECT_REASON[row.reason] ?? row.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.rejected.length > 25 && <p className="mt-1">and {r.rejected.length - 25} more.</p>}
        </Notice>
      )}
    </div>
  );
}
