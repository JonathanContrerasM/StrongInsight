import type { EnrichedSet } from '../model/effectiveLoad';
import type { ExerciseMeta } from '../model/types';
import type { MetaLookup } from './balance';
import { muscleGroup } from './profile';

/**
 * What a session trained, judged from the session itself.
 *
 * This is a different question from the recovered split in cooccurrence.ts.
 * That answers "what routine am I running" by clustering the whole history,
 * and it is the right tool for that. It was the wrong tool for "what was this
 * session": mapping a session's exercises to their clusters and taking the
 * majority ignored every exercise the clustering had dropped as rare, broke
 * ties by sort order, and inherited whatever muddle a mixed routine had put
 * into the clusters -- one bodyweight leg accessory could tag a push-and-pull
 * session as "Legs".
 *
 * Here the session's own working sets are counted by movement group, and a
 * session that is genuinely two things gets two tags.
 */

export type FocusGroup = 'push' | 'pull' | 'legs' | 'core';

/** Fixed order: tie-break for ranking, and the calendar's colour slots. */
export const FOCUS_GROUPS: readonly FocusGroup[] = ['push', 'pull', 'legs', 'core'];

export const FOCUS_LABEL: Record<FocusGroup, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  core: 'Core',
};

/**
 * A group needs this share of the session's assigned working sets to be a
 * tag. One three-set accessory in a twenty-set session is 15% and does not
 * tag; a session that is a third legs does.
 */
export const MIN_TAG_SHARE = 0.2;

export type FocusTag = { group: FocusGroup; sets: number; share: number };

export type SessionFocus = {
  /** Groups above the threshold, largest first. Empty only when nothing could be assigned. */
  tags: FocusTag[];
  /** "Push", "Push / Pull", "Full body"; "Unknown" when nothing could be assigned. */
  label: string;
  /** Working sets in every group, tagged or not, in FOCUS_GROUPS order. */
  bySets: Record<FocusGroup, number>;
  /** Working sets that mapped to no group: unknown muscle, full-body, neck. */
  unassigned: number;
  /** Working sets whose metadata is still a guess -- the focus is as good as the tag table. */
  unconfirmed: number;
  /** Working sets considered. */
  total: number;
};

/**
 * Pattern first, muscle second. The pattern is the more specific claim, but
 * `isolation` says nothing about direction -- a bicep curl is pull work and a
 * leg extension is leg work -- so it falls through to the primary muscle, as
 * do `carry` and `unknown`. labelCluster in cooccurrence.ts counts patterns
 * only, which is why accessory-heavy sessions were mislabelled there.
 */
export function focusGroupOf(meta: ExerciseMeta | undefined): FocusGroup | null {
  if (!meta) return null;
  switch (meta.pattern) {
    case 'horiz-push':
    case 'vert-push':
      return 'push';
    case 'horiz-pull':
    case 'vert-pull':
      return 'pull';
    case 'squat':
    case 'hinge':
    case 'lunge':
      return 'legs';
    case 'core':
      return 'core';
    default: {
      const g = muscleGroup(meta.primaryMuscle);
      return g === 'other' || g === 'unknown' ? null : g;
    }
  }
}

const EMPTY: SessionFocus = {
  tags: [],
  label: 'Unknown',
  bySets: { push: 0, pull: 0, legs: 0, core: 0 },
  unassigned: 0,
  unconfirmed: 0,
  total: 0,
};

/** The sets of ONE session. Counted in working sets: warm-ups out, drop sets in. */
export function sessionFocus(sets: EnrichedSet[], meta: MetaLookup): SessionFocus {
  const bySets: Record<FocusGroup, number> = { push: 0, pull: 0, legs: 0, core: 0 };
  let unassigned = 0;
  let unconfirmed = 0;
  let total = 0;

  for (const s of sets) {
    if (s.setKind === 'warmup') continue;
    total++;
    if (!s.metaConfirmed) unconfirmed++;
    const g = focusGroupOf(meta(s.canonicalName));
    if (g === null) unassigned++;
    else bySets[g]++;
  }

  if (total === 0) return EMPTY;
  const assigned = total - unassigned;
  if (assigned === 0) return { ...EMPTY, unassigned, unconfirmed, total };

  const tags: FocusTag[] = FOCUS_GROUPS.map((group) => ({
    group,
    sets: bySets[group],
    share: bySets[group] / assigned,
  }))
    .filter((t) => t.share >= MIN_TAG_SHARE)
    // By share, then by the fixed order, so a tie never depends on input order.
    .sort((a, b) => b.share - a.share || FOCUS_GROUPS.indexOf(a.group) - FOCUS_GROUPS.indexOf(b.group));

  return { tags, label: labelOf(tags), bySets, unassigned, unconfirmed, total };
}

function labelOf(tags: FocusTag[]): string {
  // With four groups the largest share is at least 25%, so this cannot be empty
  // once anything is assigned; the guard is for the type, not for a case.
  if (tags.length === 0) return 'Unknown';
  const groups = new Set(tags.map((t) => t.group));
  // Push, pull and legs together is the whole body, whatever else came along.
  if (groups.has('push') && groups.has('pull') && groups.has('legs')) return 'Full body';
  return tags.map((t) => FOCUS_LABEL[t.group]).join(' / ');
}
