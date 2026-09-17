import { useRef, useState, type ReactNode } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import { exerciseMetaMapSchema } from '../model/schemas';
import { formatDate } from '../format';
import { ThemeControl } from '../ui/ThemeControl';
import {
  Button,
  Card,
  Field,
  Notice,
  SectionLabel,
  Select,
} from '../ui/primitives';

export function SettingsView() {
  const data = useWorkoutData();
  const s = data.settings;
  const [importError, setImportError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
                Deletes the import, all metadata, bodyweight, settings and the person on the Compare tab. This cannot be undone.
              </p>
            </div>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Delete the import, all metadata, bodyweight, settings and the person on the Compare tab?')) {
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
