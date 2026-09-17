import type { GroupFrequency } from '../derive/frequency';
import { FOCUS_LABEL } from '../derive/focus';
import { Meter } from '../ui/primitives';

/**
 * One row per movement group: how often it is trained, the typical gap, and
 * how long since the last time -- against the corpus's last session, never
 * today. A group is flagged only when its gap has run past twice its own
 * typical one: the reference is the lifter's habit, not anyone's idea of an
 * ideal frequency, which the app has no opinion about.
 */
export function FrequencyTable({ rows }: { rows: GroupFrequency[] }) {
  const max = Math.max(0.01, ...rows.map((r) => r.sessionsPerWeek));
  return (
    <div>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs">
            <th className="hud-label py-1 pr-3 text-left font-medium">Group</th>
            <th className="hud-label w-1/3 py-1 pr-3 text-left font-medium">Sessions / week</th>
            <th className="hud-label py-1 pr-3 text-right font-medium">Typical gap</th>
            <th className="hud-label py-1 text-right font-medium">Last trained</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const never = r.sessions === 0;
            const overdue =
              r.daysSince !== null && r.medianGapDays !== null && r.daysSince > r.medianGapDays * 2;
            return (
              <tr key={r.group} className={never ? 'text-faint' : ''}>
                <td className="py-2 pr-3 font-medium text-ink">{FOCUS_LABEL[r.group]}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <Meter value={r.sessionsPerWeek} max={max} label={FOCUS_LABEL[r.group] + ' sessions per week'} />
                    <span className="num w-8 shrink-0 text-right text-xs text-ink">
                      {r.sessionsPerWeek.toFixed(1)}
                    </span>
                  </div>
                </td>
                <td className="num py-2 pr-3 text-right text-dim">
                  {r.medianGapDays === null ? '-' : r.medianGapDays + ' d'}
                </td>
                <td className={'num py-2 text-right ' + (overdue ? 'text-warn' : 'text-dim')}>
                  {r.daysSince === null
                    ? never
                      ? 'never'
                      : '-'
                    : r.daysSince === 0
                      ? 'last session'
                      : r.daysSince + ' d before last'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-dim">
        Any working set counts. Days are counted to your last session, not to today; a gap past
        twice the group&rsquo;s own typical one is marked.
      </p>
    </div>
  );
}
