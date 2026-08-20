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
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Meter,
  Notice,
  SectionLabel,
  Select,
} from '../ui/primitives';

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
    return <EmptyState title="Nothing imported yet">Import a CSV first.</EmptyState>;
  }

  const total = data.observed.size;
  const confirmed = total - pending.length;

  return (
    <div className="space-y-4">
      <SectionLabel>Tagging tray</SectionLabel>

      {/* A queue, so the work reads as finite and the end is visible. */}
      <Card rail>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="num text-3xl font-bold tracking-tight text-ink">{confirmed}</span>
              <span className="text-sm text-dim">
                of <span className="num">{total}</span> exercises confirmed
              </span>
            </div>
            <p className="mt-1 max-w-xl text-xs leading-relaxed text-dim">
              Every guess below is a heuristic until you approve it. Anything grouped by muscle or
              pattern carries an unverified badge until this queue is empty.
            </p>
          </div>
          {pending.length > 0 && (
            <Button onClick={() => data.confirmAll()}>Approve all {pending.length} as-is</Button>
          )}
        </div>
        <div className="mt-4">
          <Meter value={confirmed} max={total} label="Exercises confirmed" />
        </div>
      </Card>

      {pending.length === 0 ? (
        <Notice tone="good" title="Every exercise in this import has been confirmed.">
          Nothing here needs your attention.
        </Notice>
      ) : (
        <div className="space-y-1.5">
          {pending.map((o, i) => (
            <TagRow
              key={o.name}
              index={i + 1}
              name={o.name}
              setCount={o.setCount}
              first={o.firstDate}
              last={o.lastDate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TagRow({
  index,
  name,
  setCount,
  first,
  last,
}: {
  index: number;
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
    <details className="group overflow-hidden rounded-lg border border-line bg-surface">
      {/*
       * Collapsed by default: the tray can run to a hundred entries, and six
       * open selects each turned scanning the queue into scrolling past forms.
       * The guessed tags stay visible while collapsed, so a correct guess can be
       * confirmed without ever opening the row.
       */}
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 p-3 marker:content-['']">
        <span className="num w-6 shrink-0 text-xs text-faint">
          {String(index).padStart(2, '0')}
        </span>
        <span className="font-medium text-ink">{name}</span>
        <span className="num text-xs text-faint">
          {setCount} sets &middot; {formatDate(first)} to {formatDate(last)}
        </span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <Badge>{meta.equipment}</Badge>
          <Badge>{meta.loadType}</Badge>
          <Badge>{meta.primaryMuscle}</Badge>
          <Badge>{meta.pattern}</Badge>
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
            className="ml-1 text-faint transition-transform group-open:rotate-90"
          >
            <path d="M4.5 2.5 8 6l-3.5 3.5" />
          </svg>
        </span>
      </summary>

      <div className="border-t border-line p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Load type">
            <Select
              value={meta.loadType}
              onChange={(e) => update({ loadType: e.target.value as ExerciseMeta['loadType'] })}
            >
              {LOAD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Primary muscle">
            <Select
              value={meta.primaryMuscle}
              onChange={(e) =>
                update({ primaryMuscle: e.target.value as ExerciseMeta['primaryMuscle'] })
              }
            >
              {MUSCLES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Pattern">
            <Select
              value={meta.pattern}
              onChange={(e) => update({ pattern: e.target.value as ExerciseMeta['pattern'] })}
            >
              {MOVEMENT_PATTERNS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Equipment">
            <Select
              value={meta.equipment}
              onChange={(e) => update({ equipment: e.target.value as ExerciseMeta['equipment'] })}
            >
              {EQUIPMENT.map((eq) => (
                <option key={eq} value={eq}>
                  {eq}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Alias of (merge history)">
            <Select
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
            </Select>
          </Field>

          <Field label="Unilateral">
            <Checkbox
              label="single-limb"
              className="py-1.5"
              checked={meta.unilateral}
              onChange={(e) => update({ unilateral: e.target.checked })}
            />
          </Field>
        </div>

        <div className="mt-3 flex justify-end">
          <Button variant="primary" onClick={() => data.confirmMeta(name)}>
            Confirm
          </Button>
        </div>
      </div>
    </details>
  );
}
