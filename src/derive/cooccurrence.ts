import type { EnrichedSet } from '../model/effectiveLoad';
import type { MetaLookup } from './balance';

/**
 * Recover the training split that Strong's data hides.
 *
 * Strong's workout names are auto-generated time-of-day labels ("Abend-Workout")
 * and carry no routine information at all -- iteration 1 documented this. But
 * WHICH EXERCISES ARE TRAINED TOGETHER does carry it. Clustering exercises by
 * session co-occurrence reconstructs the split the athlete is actually running.
 *
 * Everything here is deterministic: given the same sets it returns the same
 * clusters in the same order, regardless of input ordering or Map iteration.
 */

export type CooccurrenceOptions = {
  /**
   * Exercises appearing in fewer workouts than this are excluded as too rare.
   * 'auto' (the default) picks the threshold that best separates the data --
   * see pickThreshold. A number forces that exact threshold.
   */
  minAppearances?: number | 'auto';
  /** Upper bound on clusters. The cut is chosen by largest merge gap below this. */
  maxClusters?: number;
  minClusters?: number;
  /**
   * Similarity measure. Cosine (Ochiai) is the default because Jaccard punishes
   * frequency asymmetry: an accessory done in 35 sessions that ALWAYS accompanies
   * a lift done in 60 scores only 0.58 under Jaccard despite perfect co-occurrence
   * from its own side. Across a corpus with one dominant exercise and a long thin
   * tail, that bias recovers "things I do often" instead of "things I do together".
   */
  similarity?: 'cosine' | 'jaccard';
};

export type Cluster = {
  /** Derived from the dominant movement pattern/muscle -- never a hardcoded list. */
  label: string;
  members: string[];
  /** Workouts in which any member appears. */
  workoutCount: number;
  /** Mean intra-cluster similarity, i.e. how tightly these actually co-occur. */
  cohesion: number;
};

export type CooccurrenceResult = {
  /** Exercise names in dendrogram leaf order -- gives a block-diagonal matrix. */
  order: string[];
  /** similarity[i][j] in `order` space, 0..1, diagonal = 1. */
  similarity: number[][];
  /** Raw co-occurrence counts, same indexing, for tooltips. */
  counts: number[][];
  /** How many workouts each ordered exercise appears in. */
  appearances: number[];
  clusters: Cluster[];
  /** Mean silhouette over clustered items, -1..1. */
  silhouette: number;
  /**
   * False when the structure is too weak to present as a split. The UI must say
   * so rather than dressing noise up as a routine.
   */
  wellSeparated: boolean;
  /** Excluded because they appear too rarely to place. */
  tooRare: Array<{ name: string; appearances: number }>;
  totalWorkouts: number;
  /** The appearance threshold actually used (resolved, if 'auto' was requested). */
  minAppearancesUsed: number;
};

const EMPTY: CooccurrenceResult = {
  order: [],
  similarity: [],
  counts: [],
  appearances: [],
  clusters: [],
  silhouette: 0,
  wellSeparated: false,
  tooRare: [],
  totalWorkouts: 0,
  minAppearancesUsed: 1,
};

/**
 * Pick the appearance threshold that best separates the data, instead of
 * hardcoding one.
 *
 * This matters: on the reference corpus a threshold of 3 leaves so many
 * one-off exercises in that push and pull merge into a single 41-member blob
 * (silhouette 0.07), while 5 cleanly recovers Push / Pull / Legs
 * (silhouette 0.13). The right value depends entirely on how varied the user's
 * exercise selection is, so it is measured per import rather than assumed.
 *
 * Candidates are rejected if they discard so much that what remains is not
 * representative.
 */
export function pickThreshold(
  sets: EnrichedSet[],
  meta: MetaLookup,
  similarity: 'cosine' | 'jaccard' = 'cosine',
): number {
  const distinct = new Set(sets.map((s) => s.canonicalName)).size;
  let best = 1;
  let bestScore = -Infinity;

  for (const candidate of [2, 3, 4, 5, 6, 8, 10]) {
    const r = cooccurrence(sets, meta, { minAppearances: candidate, similarity });
    const kept = r.order.length;
    // Need enough exercises left to be a meaningful picture of the routine.
    if (kept < 6 || kept < Math.min(8, distinct * 0.15)) continue;
    if (r.clusters.length < 2) continue;

    // Silhouette alone is biased toward discarding every hard case: raising the
    // threshold always tightens what remains. Weighting by coverage asks a
    // better question -- how much of the actual routine does this explain? --
    // and singleton clusters explain nothing, so they are penalised.
    const coverage = distinct === 0 ? 0 : kept / distinct;
    const singletons = r.clusters.filter((c) => c.members.length < 2).length;
    const singletonPenalty = 1 / (1 + singletons);
    const score = r.silhouette * coverage * singletonPenalty;

    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }
  return bestScore === -Infinity ? 2 : best;
}

export function cooccurrence(
  sets: EnrichedSet[],
  meta: MetaLookup,
  opts: CooccurrenceOptions = {},
): CooccurrenceResult {
  // --- exercise -> set of workouts ------------------------------------------
  const workoutsOf = new Map<string, Set<string>>();
  const allWorkouts = new Set<string>();
  for (const s of sets) {
    allWorkouts.add(s.workoutId);
    const set = workoutsOf.get(s.canonicalName);
    if (set) set.add(s.workoutId);
    else workoutsOf.set(s.canonicalName, new Set([s.workoutId]));
  }
  if (workoutsOf.size === 0) return EMPTY;

  const requested = opts.minAppearances ?? 'auto';
  const minAppearances =
    requested === 'auto' ? pickThreshold(sets, meta, opts.similarity ?? 'cosine') : requested;

  // Sort by name so the whole pipeline is deterministic regardless of Map order.
  const all = [...workoutsOf.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const kept = all.filter(([, w]) => w.size >= minAppearances);
  const tooRare = all
    .filter(([, w]) => w.size < minAppearances)
    .map(([name, w]) => ({ name, appearances: w.size }))
    .sort((a, b) => b.appearances - a.appearances || a.name.localeCompare(b.name));

  if (kept.length < 2) {
    return { ...EMPTY, tooRare, totalWorkouts: allWorkouts.size, minAppearancesUsed: minAppearances };
  }

  const names = kept.map(([n]) => n);
  const wsets = kept.map(([, w]) => w);
  const n = names.length;

  // --- similarity ------------------------------------------------------------
  // Never raw co-occurrence counts: those are dominated by whichever exercise is
  // simply most frequent (Pull Up appears in 81 of 199 sessions), so every pair
  // involving it would look "similar".
  //
  // Measured on the reference corpus, cosine beats Jaccard on BOTH separation and
  // coverage (silhouette 0.190 over 71 exercises vs 0.132 over 56), because
  // Jaccard penalises the frequency asymmetry between a staple lift and the
  // accessories that always accompany it.
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const counts: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  const measure = opts.similarity ?? 'cosine';

  for (let i = 0; i < n; i++) {
    sim[i]![i] = 1;
    counts[i]![i] = wsets[i]!.size;
    for (let j = i + 1; j < n; j++) {
      const a = wsets[i]!;
      const b = wsets[j]!;
      let inter = 0;
      // Iterate the smaller set.
      const [small, large] = a.size <= b.size ? [a, b] : [b, a];
      for (const w of small) if (large.has(w)) inter++;

      let value: number;
      if (measure === 'jaccard') {
        const union = a.size + b.size - inter;
        value = union === 0 ? 0 : inter / union;
      } else {
        // Ochiai / cosine on binary incidence vectors.
        const denom = Math.sqrt(a.size * b.size);
        value = denom === 0 ? 0 : inter / denom;
      }

      sim[i]![j] = value;
      sim[j]![i] = value;
      counts[i]![j] = inter;
      counts[j]![i] = inter;
    }
  }

  // --- hierarchical agglomerative clustering, average linkage ----------------
  // Average linkage: single linkage chains everything into one blob on sparse
  // data, complete linkage fragments it. Average is the stable middle.
  const tree = buildTree(sim, n);

  // --- choose the cut --------------------------------------------------------
  const minClusters = Math.max(2, opts.minClusters ?? 2);
  const maxClusters = Math.min(opts.maxClusters ?? 6, n);
  const k = chooseK(tree.mergeHeights, minClusters, maxClusters);

  const labels = cutTree(tree, n, k);
  const order = tree.leafOrder.map((i) => names[i] as string);

  // --- assemble clusters -----------------------------------------------------
  const groups = new Map<number, number[]>();
  labels.forEach((lab, i) => {
    const g = groups.get(lab);
    if (g) g.push(i);
    else groups.set(lab, [i]);
  });

  const leafRank = new Map<number, number>();
  tree.leafOrder.forEach((idx, rank) => leafRank.set(idx, rank));

  const clusterMemberNames: string[][] = [];
  const clusters: Cluster[] = [...groups.values()]
    .map((members) => {
      const memberNames = members
        .slice()
        .sort((a, b) => (leafRank.get(a) ?? 0) - (leafRank.get(b) ?? 0))
        .map((i) => names[i] as string);

      const union = new Set<string>();
      for (const i of members) for (const w of wsets[i]!) union.add(w);

      let pairSum = 0;
      let pairCount = 0;
      for (let a = 0; a < members.length; a++) {
        for (let b = a + 1; b < members.length; b++) {
          pairSum += sim[members[a]!]![members[b]!]!;
          pairCount++;
        }
      }

      clusterMemberNames.push(memberNames);
      return {
        label: labelCluster(memberNames, meta),
        members: memberNames,
        workoutCount: union.size,
        cohesion: pairCount === 0 ? 0 : pairSum / pairCount,
      };
    })
    .sort((a, b) => b.members.length - a.members.length || a.label.localeCompare(b.label));

  disambiguateLabels(clusters, meta);

  const silhouette = meanSilhouette(sim, labels, n);

  return {
    order,
    similarity: reorder(sim, tree.leafOrder),
    counts: reorder(counts, tree.leafOrder),
    appearances: tree.leafOrder.map((i) => wsets[i]!.size),
    clusters,
    silhouette,
    // A weak silhouette means the "split" is an artefact. Say so.
    wellSeparated: silhouette >= 0.12 && clusters.length >= 2,
    tooRare,
    totalWorkouts: allWorkouts.size,
    minAppearancesUsed: minAppearances,
  };
}

/**
 * Two clusters can legitimately earn the same pattern name -- a barbell leg day
 * and a bodyweight leg day are both "Legs". Rather than showing the label twice,
 * qualify duplicates by their dominant equipment, which is what actually
 * distinguishes them.
 */
function disambiguateLabels(clusters: Cluster[], meta: MetaLookup): void {
  const seen = new Map<string, Cluster[]>();
  for (const c of clusters) {
    const list = seen.get(c.label);
    if (list) list.push(c);
    else seen.set(c.label, [c]);
  }

  for (const [, group] of seen) {
    if (group.length < 2) continue;
    const used = new Set<string>();
    // Largest keeps the plain name; the rest get qualified.
    group.forEach((c, i) => {
      if (i === 0) {
        used.add(c.label);
        return;
      }
      const equip = dominantEquipment(c.members, meta);
      let candidate = equip ? c.label + ' (' + equip + ')' : c.label;
      let suffix = 2;
      while (used.has(candidate)) candidate = c.label + ' (' + (equip ?? 'group') + ' ' + suffix++ + ')';
      used.add(candidate);
      c.label = candidate;
    });
  }
}

function dominantEquipment(members: string[], meta: MetaLookup): string | null {
  const counts = new Map<string, number>();
  for (const name of members) {
    const m = meta(name);
    if (!m || m.equipment === 'unknown') continue;
    counts.set(m.equipment, (counts.get(m.equipment) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return top ? top[0] : null;
}

// --- clustering internals -----------------------------------------------------

type Tree = {
  /** merges[m] = [nodeA, nodeB] where node ids >= n are internal. */
  merges: Array<[number, number]>;
  mergeHeights: number[];
  leafOrder: number[];
};

function buildTree(sim: number[][], n: number): Tree {
  // Distance = 1 - similarity.
  const active: number[] = [];
  const members = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    active.push(i);
    members.set(i, [i]);
  }

  const dist = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? a + ':' + b : b + ':' + a);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) dist.set(key(i, j), 1 - (sim[i]![j] as number));
  }

  const merges: Array<[number, number]> = [];
  const mergeHeights: number[] = [];
  let nextId = n;

  while (active.length > 1) {
    let best = Infinity;
    let bi = 0;
    let bj = 1;
    for (let x = 0; x < active.length; x++) {
      for (let y = x + 1; y < active.length; y++) {
        const a = active[x] as number;
        const b = active[y] as number;
        const d = dist.get(key(a, b)) ?? 1;
        // Strict < keeps the first (lowest-id) pair on ties => deterministic.
        if (d < best) {
          best = d;
          bi = x;
          bj = y;
        }
      }
    }

    const a = active[bi] as number;
    const b = active[bj] as number;
    const ma = members.get(a) ?? [];
    const mb = members.get(b) ?? [];
    const merged = [...ma, ...mb];

    const id = nextId++;
    members.set(id, merged);
    merges.push([a, b]);
    mergeHeights.push(best);

    // Average linkage: distance to the merged node is the size-weighted mean.
    active.splice(bj, 1);
    active.splice(bi, 1);
    for (const other of active) {
      const da = dist.get(key(a, other)) ?? 1;
      const db = dist.get(key(b, other)) ?? 1;
      dist.set(key(id, other), (da * ma.length + db * mb.length) / merged.length);
    }
    active.push(id);
  }

  const root = active[0] ?? 0;
  return { merges, mergeHeights, leafOrder: members.get(root) ?? [] };
}

/** Cut at the largest gap between successive merge heights, within [min,max]. */
function chooseK(mergeHeights: number[], minK: number, maxK: number): number {
  const m = mergeHeights.length;
  if (m === 0) return 1;
  const lo = Math.max(2, minK);
  const hi = Math.max(lo, maxK);

  let bestK = lo;
  let bestGap = -Infinity;
  for (let k = lo; k <= hi; k++) {
    // Cutting into k clusters means undoing the last k-1 merges.
    const idx = m - k;
    if (idx < 0 || idx + 1 > m - 1) continue;
    const gap = (mergeHeights[idx + 1] as number) - (mergeHeights[idx] as number);
    if (gap > bestGap) {
      bestGap = gap;
      bestK = k;
    }
  }
  return bestK;
}

function cutTree(tree: Tree, n: number, k: number): number[] {
  // Replay merges, stopping before the final k-1, then label by component.
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r)) r = parent.get(r) as number;
    return r;
  };

  const stopAt = Math.max(0, tree.merges.length - (k - 1));
  for (let i = 0; i < stopAt; i++) {
    const m = tree.merges[i];
    if (!m) continue;
    const id = n + i;
    parent.set(find(m[0]), id);
    parent.set(find(m[1]), id);
  }

  const rootToLabel = new Map<number, number>();
  const labels: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let lab = rootToLabel.get(r);
    if (lab === undefined) {
      lab = rootToLabel.size;
      rootToLabel.set(r, lab);
    }
    labels.push(lab);
  }
  return labels;
}

/** Silhouette computed directly from the similarity matrix (distance = 1 - sim). */
function meanSilhouette(sim: number[][], labels: number[], n: number): number {
  const byLabel = new Map<number, number[]>();
  labels.forEach((l, i) => {
    const g = byLabel.get(l);
    if (g) g.push(i);
    else byLabel.set(l, [i]);
  });
  if (byLabel.size < 2) return 0;

  let total = 0;
  let counted = 0;

  for (let i = 0; i < n; i++) {
    const own = byLabel.get(labels[i] as number) ?? [];
    if (own.length <= 1) continue;

    let a = 0;
    for (const j of own) if (j !== i) a += 1 - (sim[i]![j] as number);
    a /= own.length - 1;

    let b = Infinity;
    for (const [lab, group] of byLabel) {
      if (lab === labels[i]) continue;
      let d = 0;
      for (const j of group) d += 1 - (sim[i]![j] as number);
      d /= group.length;
      if (d < b) b = d;
    }
    if (!Number.isFinite(b)) continue;

    const denom = Math.max(a, b);
    if (denom > 0) {
      total += (b - a) / denom;
      counted++;
    }
  }

  return counted === 0 ? 0 : total / counted;
}

function reorder(m: number[][], order: number[]): number[][] {
  return order.map((i) => order.map((j) => m[i]![j] as number));
}

/**
 * Name a cluster from the movement patterns its members share. Derived from
 * metadata, never from a hardcoded exercise list, so an unfamiliar routine still
 * gets a sensible name.
 */
function labelCluster(members: string[], meta: MetaLookup): string {
  const patternCount = new Map<string, number>();
  const muscleCount = new Map<string, number>();

  for (const name of members) {
    const m = meta(name);
    if (!m) continue;
    if (m.pattern !== 'unknown') patternCount.set(m.pattern, (patternCount.get(m.pattern) ?? 0) + 1);
    if (m.primaryMuscle !== 'unknown')
      muscleCount.set(m.primaryMuscle, (muscleCount.get(m.primaryMuscle) ?? 0) + 1);
  }

  const push = (patternCount.get('horiz-push') ?? 0) + (patternCount.get('vert-push') ?? 0);
  const pull = (patternCount.get('horiz-pull') ?? 0) + (patternCount.get('vert-pull') ?? 0);
  const legs =
    (patternCount.get('squat') ?? 0) + (patternCount.get('hinge') ?? 0) + (patternCount.get('lunge') ?? 0);
  const core = patternCount.get('core') ?? 0;

  const ranked: Array<[string, number]> = [
    ['Push', push],
    ['Pull', pull],
    ['Legs', legs],
    ['Core', core],
  ].sort((a, b) => (b[1] as number) - (a[1] as number)) as Array<[string, number]>;

  const top = ranked[0];
  const second = ranked[1];
  if (top && top[1] > 0) {
    // Only claim a compound name when the runner-up is genuinely comparable.
    if (second && second[1] > 0 && second[1] >= top[1] * 0.7) return top[0] + ' / ' + second[0];
    return top[0];
  }

  // No usable pattern data: fall back to the dominant muscle, then to a member.
  const topMuscle = [...muscleCount.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
  )[0];
  if (topMuscle) return topMuscle[0].charAt(0).toUpperCase() + topMuscle[0].slice(1);
  return members[0] ?? 'Group';
}
