import { useRef, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { exerciseMetaMapSchema } from '../model/schemas';
import type { BodyweightEntry } from '../model/types';
import { formatDate } from '../format';

export function SettingsView() {
  const data = useWorkoutData();
  const s = data.settings;
  const [newDate, setNewDate] = useState(formatDate(new Date()));
  const [newKg, setNewKg] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const sorted = [...data.bodyweight].sort((a, b) => a.date.localeCompare(b.date));

  const addEntry = () => {
    const kg = Number(newKg.replace(',', '.'));
    if (!Number.isFinite(kg) || kg <= 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) return;
    const next: BodyweightEntry[] = [
      ...data.bodyweight.filter((e) => e.date !== newDate),
      { date: newDate, kg },
    ].sort((a, b) => a.date.localeCompare(b.date));
    data.setBodyweight(next);
    setNewKg('');
  };

  const exportMeta = () => {
    const blob = new Blob([JSON.stringify(data.meta, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'stronginsight-metadata.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importMeta = async (file: File) => {
    setImportError(null);
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const result = exerciseMetaMapSchema.safeParse(parsed);
      if (!result.success) {
        setImportError('Not a valid metadata file: ' + result.error.issues[0]?.message);
        return;
      }
      data.replaceMeta(result.data);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="max-w-3xl space-y-8">
      <section>
        <h2 className="text-lg font-semibold text-slate-900">Units and week</h2>
        <p className="text-sm text-slate-500">
          Everything is stored in kilograms internally; the display unit only affects rendering.
          The input unit is stamped onto each import, because Strong rewrites its whole history
          when you change its unit setting.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">
              Input unit (new imports)
            </span>
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={s.inputUnit}
              onChange={(e) => data.updateSettings({ inputUnit: e.target.value as 'kg' | 'lb' })}
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">
              Display unit
            </span>
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={s.displayUnit}
              onChange={(e) => data.updateSettings({ displayUnit: e.target.value as 'kg' | 'lb' })}
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">
              Week starts on
            </span>
            <select
              className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
              value={s.weekStartsOn}
              onChange={(e) =>
                data.updateSettings({ weekStartsOn: Number(e.target.value) === 0 ? 0 : 1 })
              }
            >
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </select>
          </label>
        </div>
        {data.current && data.current.unit !== s.inputUnit && (
          <p className="mt-2 rounded bg-amber-50 p-2 text-sm text-amber-800">
            The current import was read as <strong>{data.current.unit}</strong>, which differs from
            the input unit now selected. Re-import to reinterpret it.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Bodyweight history</h2>
        <p className="text-sm text-slate-500">
          31% of the working sets in this corpus are bodyweight movements, so without this every
          pull up and push up computes to zero volume. Values are interpolated linearly between
          entries and clamped outside the recorded range.
        </p>

        {data.bodyweight.length === 0 && (
          <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">No bodyweight recorded yet.</p>
            <p className="mt-1">
              Bodyweight exercises currently fall back to the default of{' '}
              <strong>{s.defaultBodyweightKg} kg</strong>. Add at least one real entry below to make
              those numbers meaningful.
            </p>
            <label className="mt-2 block">
              <span className="mb-0.5 block text-xs uppercase tracking-wide">Fallback default (kg)</span>
              <input
                type="number"
                className="w-32 rounded border border-amber-300 px-2 py-1"
                value={s.defaultBodyweightKg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v) && v > 0) data.updateSettings({ defaultBodyweightKg: v });
                }}
              />
            </label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">Date</span>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className="rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">
              Weight (kg)
            </span>
            <input
              type="number"
              step="0.1"
              value={newKg}
              onChange={(e) => setNewKg(e.target.value)}
              className="w-28 rounded border border-slate-300 px-2 py-1 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={addEntry}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
          >
            Add / update
          </button>
        </div>

        {sorted.length > 0 && (
          <table className="mt-3 w-full max-w-md text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Date</th>
                <th className="py-1 text-right">kg</th>
                <th />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.map((e) => (
                <tr key={e.date}>
                  <td className="py-1 tabular-nums">{e.date}</td>
                  <td className="py-1 text-right tabular-nums">
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={e.kg}
                      onBlur={(ev) => {
                        const v = Number(ev.target.value);
                        if (Number.isFinite(v) && v > 0 && v !== e.kg) {
                          data.setBodyweight(
                            data.bodyweight.map((x) => (x.date === e.date ? { ...x, kg: v } : x)),
                          );
                        }
                      }}
                      className="w-24 rounded border border-slate-200 px-1 py-0.5 text-right"
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        data.setBodyweight(data.bodyweight.filter((x) => x.date !== e.date))
                      }
                      className="text-sm text-red-700 hover:underline"
                    >
                      delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-slate-900">Metadata</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={exportMeta}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Export metadata as JSON
          </button>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Import metadata from JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importMeta(f);
              e.target.value = '';
            }}
          />
        </div>
        {importError && <p className="mt-2 text-sm text-red-700">{importError}</p>}
      </section>

      {data.archive.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-slate-900">Archived imports</h2>
          <p className="text-sm text-slate-500">
            The last {data.archive.length} import(s), kept so a bad export can be rolled back.
          </p>
          <ul className="mt-2 divide-y divide-slate-100 text-sm">
            {data.archive.map((a, i) => (
              <li key={i} className="flex items-center justify-between py-1.5">
                <span>
                  {a.filename}{' '}
                  <span className="text-slate-500">
                    ({formatDate(new Date(a.importedAt))}, {a.unit},{' '}
                    {Math.round(a.text.length / 1024)} KB)
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => void data.rollbackTo(a)}
                  className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-50"
                >
                  Restore
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="text-lg font-semibold text-red-900">Danger zone</h2>
        <button
          type="button"
          onClick={() => {
            if (confirm('Delete the import, all metadata, bodyweight and settings?')) {
              void data.reset();
            }
          }}
          className="mt-2 rounded border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-medium text-red-800 hover:bg-red-100"
        >
          Reset everything
        </button>
      </section>
    </div>
  );
}
