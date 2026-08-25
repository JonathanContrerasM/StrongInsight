import { useRef, useState, type ReactNode } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { exerciseMetaMapSchema } from '../model/schemas';
import type { BodyweightEntry } from '../model/types';
import { formatDate } from '../format';
import { ThemeControl } from '../ui/ThemeControl';
import {
  Button,
  Card,
  Field,
  Input,
  Notice,
  SectionLabel,
  Select,
} from '../ui/primitives';

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
      <Section
        label="Appearance"
        title="Theme"
        blurb="System follows your operating system and changes with it. This preference is stored per device and is not affected by Reset everything below."
      >
        <div className="mt-3">
          <ThemeControl />
        </div>
      </Section>

      <Section
        label="Units"
        title="Units and week"
        blurb="Everything is stored in kilograms internally; the display unit only affects rendering. The input unit is stamped onto each import, because Strong rewrites its whole history when you change its unit setting."
      >
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Input unit (new imports)">
            <Select
              value={s.inputUnit}
              onChange={(e) => data.updateSettings({ inputUnit: e.target.value as 'kg' | 'lb' })}
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </Select>
          </Field>
          <Field label="Display unit">
            <Select
              value={s.displayUnit}
              onChange={(e) => data.updateSettings({ displayUnit: e.target.value as 'kg' | 'lb' })}
            >
              <option value="kg">kg</option>
              <option value="lb">lb</option>
            </Select>
          </Field>
          <Field label="Week starts on">
            <Select
              value={s.weekStartsOn}
              onChange={(e) =>
                data.updateSettings({ weekStartsOn: Number(e.target.value) === 0 ? 0 : 1 })
              }
            >
              <option value={1}>Monday</option>
              <option value={0}>Sunday</option>
            </Select>
          </Field>
        </div>
        {data.current && data.current.unit !== s.inputUnit && (
          <div className="mt-3">
            <Notice tone="warn">
              The current import was read as <strong>{data.current.unit}</strong>, which differs from
              the input unit now selected. Re-import to reinterpret it.
            </Notice>
          </div>
        )}
      </Section>

      <Section
        label="Bodyweight"
        title="Bodyweight history"
        blurb="31% of the working sets in this corpus are bodyweight movements, so without this every pull up and push up computes to zero volume. Values are interpolated linearly between entries and clamped outside the recorded range."
      >
        {data.bodyweight.length === 0 && (
          <div className="mt-3">
            <Notice tone="warn" title="No bodyweight recorded yet.">
              <p>
                Bodyweight exercises currently fall back to the default of{' '}
                <strong>{s.defaultBodyweightKg} kg</strong>. Add at least one real entry below to
                make those numbers meaningful.
              </p>
              <div className="mt-2 w-40">
                <Field label="Fallback default (kg)">
                  <Input
                    type="number"
                    value={s.defaultBodyweightKg}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v) && v > 0) data.updateSettings({ defaultBodyweightKg: v });
                    }}
                  />
                </Field>
              </div>
            </Notice>
          </div>
        )}

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
                      <Input
                        type="number"
                        step="0.1"
                        defaultValue={e.kg}
                        className="w-24 text-right"
                        onBlur={(ev) => {
                          const v = Number(ev.target.value);
                          if (Number.isFinite(v) && v > 0 && v !== e.kg) {
                            data.setBodyweight(
                              data.bodyweight.map((x) => (x.date === e.date ? { ...x, kg: v } : x)),
                            );
                          }
                        }}
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-danger"
                        onClick={() =>
                          data.setBodyweight(data.bodyweight.filter((x) => x.date !== e.date))
                        }
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
      </Section>

      <Section
        label="Metadata"
        title="Export and import tags"
        blurb="Your confirmed exercise metadata, as a JSON file you can keep or move to another browser."
      >
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={exportMeta}>Export metadata as JSON</Button>
          <Button onClick={() => fileRef.current?.click()}>Import metadata from JSON</Button>
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
        {importError && (
          <div className="mt-3">
            <Notice tone="danger" title="Import failed">
              {importError}
            </Notice>
          </div>
        )}
      </Section>

      {data.archive.length > 0 && (
        <Section
          label="Archive"
          title="Archived imports"
          blurb={
            'The last ' + data.archive.length + ' import(s), kept so a bad export can be rolled back.'
          }
        >
          <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
            {data.archive.map((a, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="text-ink">{a.filename}</span>{' '}
                  <span className="num text-xs text-faint">
                    ({formatDate(new Date(a.importedAt))}, {a.unit},{' '}
                    {Math.round(a.text.length / 1024)} KB)
                  </span>
                </span>
                <Button size="sm" onClick={() => void data.rollbackTo(a)}>
                  Restore
                </Button>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <section>
        <SectionLabel>Danger zone</SectionLabel>
        <Card className="border-danger-line">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-ink">Reset everything</h2>
              <p className="mt-0.5 text-xs text-dim">
                Deletes the import, all metadata, bodyweight and settings. This cannot be undone.
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Delete the import, all metadata, bodyweight and settings?')) {
                  void data.reset();
                }
              }}
            >
              Reset everything
            </Button>
          </div>
        </Card>
      </section>
    </div>
  );
}

function Section({
  label,
  title,
  blurb,
  children,
}: {
  label: string;
  title: string;
  blurb: ReactNode;
  children: ReactNode;
}) {
  return (
    <section>
      <SectionLabel>{label}</SectionLabel>
      <Card>
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <p className="mt-1 max-w-2xl text-xs leading-relaxed text-dim">{blurb}</p>
        {children}
      </Card>
    </section>
  );
}
