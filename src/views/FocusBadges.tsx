import { FOCUS_LABEL, type SessionFocus } from '../derive/focus';
import { Badge } from '../ui/primitives';

/**
 * A session's focus as one badge per tag. Shared by the Sessions list and the
 * session page so the two cannot describe the same session differently.
 *
 * When most of the working sets rest on guessed metadata the badges carry the
 * app-wide `unverified` treatment: the focus is exactly as good as the tag table.
 */
export function FocusBadges({ focus }: { focus: SessionFocus }) {
  if (focus.tags.length === 0) {
    return (
      <span className="text-xs text-faint" title={unassignedTitle(focus)}>
        {focus.total === 0 ? '-' : 'unknown'}
      </span>
    );
  }
  const guessed = focus.unconfirmed * 2 > focus.total;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {focus.tags.map((t) => (
        <Badge
          key={t.group}
          tone={guessed ? 'warn' : 'accent'}
          dot={guessed}
          title={
            t.sets + ' of ' + focus.total + ' working sets (' + Math.round(t.share * 100) + '%)' +
            (guessed ? ' -- most of this session’s tags are unconfirmed guesses' : '') +
            (focus.unassigned > 0 ? '; ' + unassignedTitle(focus) : '')
          }
        >
          {FOCUS_LABEL[t.group]}
        </Badge>
      ))}
    </span>
  );
}

function unassignedTitle(f: SessionFocus): string {
  return f.unassigned + ' set' + (f.unassigned === 1 ? '' : 's') + ' with no muscle group';
}
