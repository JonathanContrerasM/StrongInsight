import type { RecordEvent } from '../derive/records';
import type { WeightUnit } from '../model/types';
import { formatDate, formatLoad, formatWeight } from '../format';
import { Badge } from '../ui/primitives';
import { KIND_LABEL } from '../viz/Records';

/**
 * Records as rows: date, what was beaten, by how much. Shared by the Dashboard
 * (newest ten, exercise named) and a lift's page (all of them, exercise
 * implied), so the two never describe the same record differently.
 */
export function RecordList({
  events,
  unit,
  showExercise = true,
  onSelectExercise,
  onSelectSession,
}: {
  /** In display order. */
  events: RecordEvent[];
  unit: WeightUnit;
  showExercise?: boolean;
  onSelectExercise?: (name: string) => void;
  onSelectSession?: (workoutId: string) => void;
}) {
  if (events.length === 0) return null;
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-sm">
          {onSelectSession ? (
            <button
              type="button"
              className="num shrink-0 text-xs text-dim transition-colors hover:text-ink"
              title="Open the session"
              onClick={() => onSelectSession(e.workoutId)}
            >
              {formatDate(e.date)}
            </button>
          ) : (
            <span className="num shrink-0 text-xs text-dim">{formatDate(e.date)}</span>
          )}
          {showExercise &&
            (onSelectExercise ? (
              <button
                type="button"
                className="min-w-0 truncate text-left text-ink transition-colors hover:text-accent-ink"
                onClick={() => onSelectExercise(e.exercise)}
              >
                {e.exercise}
              </button>
            ) : (
              <span className="min-w-0 truncate text-ink">{e.exercise}</span>
            ))}
          <span className="num ml-auto shrink-0 text-ink">{describe(e, unit)}</span>
          <Badge title={KIND_LABEL[e.kind]}>{KIND_LABEL[e.kind]}</Badge>
          {e.bodyweightDriven && (
            <Badge tone="neutral" title="The effective load moved with your bodyweight history, not the plates">
              bodyweight
            </Badge>
          )}
        </li>
      ))}
    </ul>
  );
}

/**
 * "120 kg (was 115)", "e1RM 135 kg (was 130)", "8 reps at 100 kg (was 6)" --
 * and on a bodyweight-relative lift the load carries its split:
 * "120.0 kg (80.0 bw + 40.0) (was 115.0 kg)".
 */
export function describe(e: RecordEvent, unit: WeightUnit): string {
  if (e.kind === 'reps-at-load') {
    return (
      e.value + ' reps at ' + formatLoad(e.parts, e.loadKg ?? 0, unit, 0) + ' (was ' + e.previous + ')'
    );
  }
  if (e.kind === 'e1rm') {
    const from = e.parts ? ' from ' + formatLoad(e.parts, e.parts.totalKg, unit, 1) : '';
    return 'e1RM ' + formatWeight(e.value, unit, 1) + from + ' (was ' + formatWeight(e.previous, unit, 1) + ')';
  }
  return formatLoad(e.parts, e.value, unit, 1) + ' (was ' + formatWeight(e.previous, unit, 1) + ')';
}
