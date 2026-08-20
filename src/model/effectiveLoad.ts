import type { ExerciseMeta, LoadType, ParsedSet, SetRecord } from './types';
import type { BodyweightResolver } from './bodyweight';

/**
 * Effective load is ALWAYS derived, never persisted. Correcting a loadType or a
 * bodyweight entry therefore retroactively fixes the whole history.
 */

export type EffectiveLoadInput = {
  loadType: LoadType;
  weightKg: number | null;
  bodyweightKg: number | null;
};

/**
 * The six-way resolution table.
 *
 * Returns null when load is not quantifiable (duration/distance work), or when a
 * bodyweight-relative type has no bodyweight to resolve against -- null means
 * "unknown", and callers must exclude it rather than treating it as zero.
 */
export function effectiveLoad({ loadType, weightKg, bodyweightKg }: EffectiveLoadInput): number | null {
  switch (loadType) {
    case 'external':
      return weightKg;
    case 'bodyweight':
      return bodyweightKg;
    case 'bodyweight-plus':
      // The weight column is ADDED load (Pull Up +20kg).
      return bodyweightKg === null ? null : bodyweightKg + (weightKg ?? 0);
    case 'assisted':
      // The weight column is ASSISTANCE, so it subtracts. Never let it go negative.
      return bodyweightKg === null ? null : Math.max(0, bodyweightKg - (weightKg ?? 0));
    case 'duration':
    case 'distance':
      return null;
    default: {
      const never: never = loadType;
      return never;
    }
  }
}

/** A set with metadata applied. This is what every derive function consumes. */
export type EnrichedSet = SetRecord & {
  /** Alias-resolved name. Group on THIS, never on exerciseName. */
  canonicalName: string;
  effectiveLoadKg: number | null;
  loadType: LoadType;
  /** False when the exercise's metadata is still an unconfirmed guess. */
  metaConfirmed: boolean;
};

export type MetaResolver = {
  /** Never returns undefined -- unknown names get an ephemeral unconfirmed default. */
  resolve(name: string): { canonical: string; meta: ExerciseMeta };
};

/**
 * The single pass that turns parser output into the model every consumer sees.
 *
 * Deliberately separate from parseCsv: parsing must not depend on metadata, or
 * every tagging keystroke would re-parse thousands of CSV rows. This pass is one
 * map over the sets and is cheap enough to re-run whenever metadata changes.
 */
export function enrichSets(
  sets: ParsedSet[],
  meta: MetaResolver,
  bodyweightAt: BodyweightResolver,
): EnrichedSet[] {
  return sets.map((s) => {
    const { canonical, meta: m } = meta.resolve(s.exerciseName);
    const bw = bodyweightAt(s.date);
    const load = effectiveLoad({
      loadType: m.loadType,
      weightKg: s.weightKg,
      bodyweightKg: bw,
    });

    // A null weight is MISSING DATA, not an unloaded set -- keep them distinct.
    // FUTURE: charts must decide whether to exclude unloaded sets or impute a bar
    // weight. Keep this a flag; do not bake imputation into effectiveLoadKg, or a
    // settings change would silently rewrite history.
    const isUnloaded = m.loadType === 'external' && s.weightKg === 0 && (s.reps ?? 0) > 0;

    return {
      ...s,
      isUnloaded,
      canonicalName: canonical,
      effectiveLoadKg: load,
      loadType: m.loadType,
      metaConfirmed: m.confirmed,
    };
  });
}
