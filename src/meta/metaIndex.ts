import type { ExerciseMeta } from '../model/types';
import type { MetaResolver } from '../model/effectiveLoad';
import { guessMeta } from './guessMeta';

/**
 * Flattens alias chains once, so no derive function ever reads `aliasOf`.
 * Grouping keys downstream are ALWAYS the canonical name.
 */

export type MetaIssue =
  | { kind: 'alias-cycle'; names: string[] }
  | { kind: 'alias-dangling'; name: string; target: string }
  | { kind: 'alias-depth'; name: string };

/** Guards against a pathological chain even if the cycle check somehow misses. */
const MAX_HOPS = 16;

export type MetaIndex = MetaResolver & {
  readonly issues: MetaIssue[];
  /** Canonical name for a raw name (identity when it is not an alias). */
  canonicalOf(name: string): string;
  readonly map: Record<string, ExerciseMeta>;
};

export function buildMetaIndex(meta: Record<string, ExerciseMeta>): MetaIndex {
  const issues: MetaIssue[] = [];
  const canonical = new Map<string, string>();

  const resolveChain = (start: string): string => {
    const cached = canonical.get(start);
    if (cached !== undefined) return cached;

    const path: string[] = [];
    const seen = new Set<string>();
    let cur = start;

    for (let hops = 0; ; hops++) {
      if (hops > MAX_HOPS) {
        issues.push({ kind: 'alias-depth', name: start });
        cur = start;
        break;
      }
      if (seen.has(cur)) {
        // Break at the node we started from, so the result is deterministic
        // regardless of which member of the cycle we entered through.
        issues.push({ kind: 'alias-cycle', names: [...path] });
        cur = start;
        break;
      }
      seen.add(cur);
      path.push(cur);

      const entry = meta[cur];
      const target = entry?.aliasOf?.trim();
      if (!target || target === cur) break;

      if (meta[target] === undefined) {
        // Do not auto-create the target; the alias simply does not resolve.
        issues.push({ kind: 'alias-dangling', name: cur, target });
        break;
      }
      cur = target;
    }

    // Path compression: every node on the walk shares the answer.
    for (const n of path) canonical.set(n, cur);
    return cur;
  };

  for (const name of Object.keys(meta)) resolveChain(name);

  const ephemeral = new Map<string, ExerciseMeta>();

  const index: MetaIndex = {
    issues,
    map: meta,
    canonicalOf(name: string) {
      return canonical.get(name) ?? resolveChain(name);
    },
    /**
     * Never returns undefined. An unknown name gets a guessed, unconfirmed entry
     * so no consumer needs a null check and the frame between "CSV imported" and
     * "metadata effect committed" still renders sensible values.
     */
    resolve(name: string) {
      const canon = index.canonicalOf(name);
      const found = meta[canon] ?? meta[name];
      if (found) return { canonical: canon, meta: found };

      let temp = ephemeral.get(name);
      if (!temp) {
        temp = guessMeta(name);
        ephemeral.set(name, temp);
      }
      return { canonical: canon, meta: temp };
    },
  };

  return index;
}
