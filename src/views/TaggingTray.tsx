import { useMemo, useState } from 'react';
import { useWorkoutData } from '../store/useWorkoutData';
import {
  EQUIPMENT,
  LOAD_TYPES,
  MOVEMENT_PATTERNS,
  MUSCLES,
  type ExerciseMeta,
} from '../model/types';
import { formatDate } from '../format';

/**
 * Lists every exercise still awaiting approval, highest set count first, so the
 * most impactful tags get fixed before the long tail.
 *
 * Edits commit on change/blur rather than per keystroke: metadata is persisted and
 * feeds the enrich pass, so a keystroke-level write would churn the whole model.
 */
export function TaggingTray() {
  const data = useWorkoutData();

  const pending = useMemo(() => {
    return [...data.observed.values()]
      .filter((o) => data.meta[o.name]?.confirmed !== true)
      .sort((a, b) => b.setCount - a.setCount);
  }, [data.observed, data.meta]);

  if (data.current === null) {
    return <p className="text-slate-500">Import a CSV first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-slate-900">Tagging tray</h2>
          <p className="text-sm text-slate-500">
            {pending.length} of {data.observed.size} exercises still unconfirmed. Every guess below
            is a heuristic until you approve it.
          </p>
        </div>
        {pending.length > 0 && (
          <button
            type="button"
            onClick={() => data.confirmAll()}
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Approve all {pending.length} as-is
          </button>
        )}
      </div>

      {pending.length === 0 ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          Every exercise in this import has been confirmed.
        </p>
      ) : (
        <div className="space-y-2">
          {pending.map((o) => (
            <TagRow key={o.name} name={o.name} setCount={o.setCount} first={o.firstDate} last={o.lastDate} />
          ))}
        </div>
      )}
    </div>
  );
}

function TagRow({
  name,
  setCount,
  first,
  last,
}: {
  name: string;
  setCount: number;
  first: Date | null;
  last: Date | null;
}) {
  const data = useWorkoutData();
  const meta = data.meta[name];
  const [aliasDraft, setAliasDraft] = useState(meta?.aliasOf ?? '');

  if (!meta) return null;

  const update = (patch: Partial<ExerciseMeta>) => data.updateMeta(name, patch);

  // Offer only names that cannot create a cycle back to this one.
  const aliasTargets = [...data.observed.keys()]
    .filter((n) => n !== name && data.metaIndex.canonicalOf(n) !== name)
    .sort();

  return (
    <div className="rounded border border-amber-200 bg-white p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-medium text-slate-900">{name}</span>
          <span
            className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
            title="Metadata is an unconfirmed guess"
          >
            unverified
          </span>
        </div>
        <div className="text-sm text-slate-500 tabular-nums">
          {setCount} sets &middot; {formatDate(first)} to {formatDate(last)}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="Load type">
          <select
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={meta.loadType}
            onChange={(e) => update({ loadType: e.target.value as ExerciseMeta['loadType'] })}
          >
            {LOAD_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Primary muscle">
          <select
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={meta.primaryMuscle}
            onChange={(e) => update({ primaryMuscle: e.target.value as ExerciseMeta['primaryMuscle'] })}
          >
            {MUSCLES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Pattern">
          <select
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={meta.pattern}
            onChange={(e) => update({ pattern: e.target.value as ExerciseMeta['pattern'] })}
          >
            {MOVEMENT_PATTERNS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Equipment">
          <select
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={meta.equipment}
            onChange={(e) => update({ equipment: e.target.value as ExerciseMeta['equipment'] })}
          >
            {EQUIPMENT.map((eq) => (
              <option key={eq} value={eq}>
                {eq}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Alias of (merge history)">
          <select
            className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
            value={aliasDraft}
            onChange={(e) => {
              setAliasDraft(e.target.value);
              update({ aliasOf: e.target.value || undefined });
            }}
          >
            <option value="">(none)</option>
            {aliasTargets.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Unilateral">
          <label className="flex items-center gap-2 py-1 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={meta.unilateral}
              onChange={(e) => update({ unilateral: e.target.checked })}
            />
            single-limb
          </label>
        </Field>
      </div>

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={() => data.confirmMeta(name)}
          className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700"
        >
          Confirm
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-xs uppercase tracking-wide text-slate-500">{label}</span>
      {children}
    </label>
  );
}
