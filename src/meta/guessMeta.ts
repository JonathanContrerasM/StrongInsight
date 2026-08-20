import type { ExerciseMeta, LoadType, MovementPattern, Muscle } from '../model/types';
import { loadTypeFromEquipment, parseExerciseName } from './equipment';

/**
 * Token-based heuristics over the exercise name. Deliberately NOT a lookup table
 * of known exercises -- any name a user invents must flow through here and come
 * out with a usable guess, marked unconfirmed.
 *
 * Rules are ordered and the FIRST match wins, so specific patterns must sit above
 * generic ones. Two orderings are load-bearing and have already caused bugs:
 *   - "leg curl" must precede the generic "curl" rule, or Seated Leg Curl
 *     resolves to biceps.
 *   - "farmer/carry" must precede the cardio rule, or Farmer Walk is classified
 *     as a distance exercise because of the word "walk".
 */

type Rule = {
  test: RegExp;
  primary?: Muscle;
  secondary?: Muscle[];
  pattern?: MovementPattern;
  loadType?: LoadType;
  unilateral?: boolean;
};

/** Matched against a normalised (lowercase, de-accented, single-spaced) name. */
const RULES: Rule[] = [
  // --- holds and timed work: must precede movement rules -----------------------
  {
    test: /\b(plank|hollow hold|wall sit|dead ?hang|deadhang|l ?sit|superman)\b/,
    primary: 'abs',
    pattern: 'core',
    loadType: 'duration',
  },
  {
    test: /\bhandstand\b/,
    primary: 'shoulders',
    secondary: ['abs', 'triceps'],
    pattern: 'vert-push',
    loadType: 'duration',
  },
  { test: /\bhold\b/, primary: 'full-body', pattern: 'core', loadType: 'duration' },

  // --- carries: MUST precede cardio, or "Farmer Walk" becomes a distance run ---
  { test: /\b(farmer|carry)\b/, primary: 'forearms', secondary: ['traps'], pattern: 'carry' },

  // --- distance / cardio -------------------------------------------------------
  {
    test: /\b(run|running|jog|treadmill|cycl|bike|rowing machine|stepper|elliptical|swim|walk)\b/,
    primary: 'full-body',
    pattern: 'carry',
    loadType: 'distance',
  },

  // --- vertical pull -----------------------------------------------------------
  {
    test: /\bmuscle ?up\b/,
    primary: 'lats',
    secondary: ['biceps', 'chest', 'triceps'],
    pattern: 'vert-pull',
    loadType: 'bodyweight-plus',
  },
  {
    test: /\b(pull ?up|chin ?up|pullup|chinup)\b/,
    primary: 'lats',
    secondary: ['biceps', 'back'],
    pattern: 'vert-pull',
    loadType: 'bodyweight-plus',
  },
  {
    test: /\b(lat pull ?down|pulldown|pull down)\b/,
    primary: 'lats',
    secondary: ['biceps'],
    pattern: 'vert-pull',
  },

  // --- dips: bodyweight-plus, and chest vs triceps -----------------------------
  {
    test: /\bbench dip\b/,
    primary: 'triceps',
    secondary: ['chest'],
    pattern: 'vert-push',
    loadType: 'bodyweight-plus',
  },
  {
    test: /\bdip\b/,
    primary: 'chest',
    secondary: ['triceps', 'shoulders'],
    pattern: 'vert-push',
    loadType: 'bodyweight-plus',
  },

  // --- push ups ----------------------------------------------------------------
  {
    test: /\b(push ?up|pushup)\b/,
    primary: 'chest',
    secondary: ['triceps', 'shoulders'],
    pattern: 'horiz-push',
    loadType: 'bodyweight-plus',
  },

  // --- presses: disambiguate before the generic rule ---------------------------
  {
    test: /\b(overhead|shoulder|military|arnold|z) press\b/,
    primary: 'shoulders',
    secondary: ['triceps'],
    pattern: 'vert-push',
  },
  {
    test: /\bincline (bench )?press\b/,
    primary: 'chest',
    secondary: ['shoulders', 'triceps'],
    pattern: 'horiz-push',
  },
  {
    test: /\b(decline|bench|chest) ?press\b/,
    primary: 'chest',
    secondary: ['triceps', 'shoulders'],
    pattern: 'horiz-push',
  },
  { test: /\bleg press\b/, primary: 'quads', secondary: ['glutes'], pattern: 'squat' },
  { test: /\bcalf press\b/, primary: 'calves', pattern: 'isolation' },
  { test: /\bpress\b/, primary: 'shoulders', secondary: ['triceps'], pattern: 'vert-push' },

  // --- rows --------------------------------------------------------------------
  { test: /\bface pull\b/, primary: 'shoulders', secondary: ['traps'], pattern: 'horiz-pull' },
  { test: /\brow\b/, primary: 'back', secondary: ['lats', 'biceps'], pattern: 'horiz-pull' },

  // --- squat / hinge / lunge ---------------------------------------------------
  {
    test: /\b(bulgarian|split squat)\b/,
    primary: 'quads',
    secondary: ['glutes'],
    pattern: 'lunge',
    unilateral: true,
  },
  {
    test: /\bpistol squat\b/,
    primary: 'quads',
    secondary: ['glutes'],
    pattern: 'squat',
    unilateral: true,
  },
  { test: /\bsquat\b/, primary: 'quads', secondary: ['glutes', 'lower-back'], pattern: 'squat' },
  {
    test: /\b(lunge|step ?up)\b/,
    primary: 'quads',
    secondary: ['glutes'],
    pattern: 'lunge',
    unilateral: true,
  },
  {
    test: /\b(romanian deadlift|rdl|good ?morning)\b/,
    primary: 'hamstrings',
    secondary: ['glutes', 'lower-back'],
    pattern: 'hinge',
  },
  {
    test: /\bdeadlift\b/,
    primary: 'hamstrings',
    secondary: ['glutes', 'lower-back', 'traps'],
    pattern: 'hinge',
  },
  { test: /\bhip thrust\b/, primary: 'glutes', secondary: ['hamstrings'], pattern: 'hinge' },
  {
    test: /\b(glute ham raise|ghr)\b/,
    primary: 'hamstrings',
    secondary: ['glutes'],
    pattern: 'hinge',
  },
  { test: /\bback extension\b/, primary: 'lower-back', secondary: ['glutes'], pattern: 'hinge' },

  // --- isolation ---------------------------------------------------------------
  // Leg curl/extension MUST precede the generic curl rule below.
  { test: /\bleg extension\b/, primary: 'quads', pattern: 'isolation' },
  { test: /\bleg curl\b/, primary: 'hamstrings', pattern: 'isolation' },
  {
    test: /\b(hammer curl|reverse curl|wrist curl)\b/,
    primary: 'forearms',
    secondary: ['biceps'],
    pattern: 'isolation',
  },
  { test: /\b(bicep|biceps|curl)\b/, primary: 'biceps', pattern: 'isolation' },
  {
    test: /\b(triceps|tricep|pushdown|skull ?crusher|kickback)\b/,
    primary: 'triceps',
    pattern: 'isolation',
  },
  { test: /\blateral raise\b/, primary: 'shoulders', pattern: 'isolation' },
  {
    test: /\b(front raise|rear delt|reverse fly|rear shoulder)\b/,
    primary: 'shoulders',
    pattern: 'isolation',
  },
  { test: /\b(shrug|trapez|traps)\b/, primary: 'traps', pattern: 'isolation' },
  { test: /\b(chest fly|fly|pec deck)\b/, primary: 'chest', pattern: 'isolation' },
  { test: /\bcalf raise\b/, primary: 'calves', pattern: 'isolation' },
  { test: /\b(abductor|abduction)\b/, primary: 'abductors', pattern: 'isolation' },
  { test: /\b(adductor|adduction)\b/, primary: 'adductors', pattern: 'isolation' },
  { test: /\bwrist\b/, primary: 'forearms', pattern: 'isolation' },
  { test: /\bneck\b/, primary: 'neck', pattern: 'isolation' },

  // --- core --------------------------------------------------------------------
  { test: /\b(russian twist|oblique|side bend)\b/, primary: 'obliques', pattern: 'core' },
  {
    test: /\b(crunch|sit ?up|leg raise|knee raise|ab wheel|toes to bar|hanging)\b/,
    primary: 'abs',
    pattern: 'core',
  },

  // --- conditioning ------------------------------------------------------------
  {
    test: /\b(jumping jack|burpee|mountain climber|jump rope)\b/,
    primary: 'full-body',
    pattern: 'core',
    loadType: 'bodyweight',
  },
];

/** Words that mark a movement as single-limb. */
const UNILATERAL =
  /\b(single|one|1) ?(arm|leg|side)\b|\bunilateral\b|\bsplit\b|\bpistol\b|\bside plank\b/;

/** Words that mark the weight column as assistance rather than added load. */
const ASSISTED = /\bassist(ed|ance)?\b|\bassited\b/;

export function normaliseName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[-_/]+/g, ' ')
    .replace(/\s+/g, ' ');
}

export type GuessOptions = {
  /** What was actually logged for this name, used to sharpen ambiguous load types. */
  observedWeights?: { anyNonZero: boolean; anySeconds: boolean; anyDistance: boolean };
};

/**
 * Best-effort metadata for a name we have never seen. Always returns something,
 * always marked confirmed: false.
 */
export function guessMeta(rawName: string, opts: GuessOptions = {}): ExerciseMeta {
  const parsed = parseExerciseName(rawName);
  const norm = normaliseName(rawName);
  // Match the full normalised name so a variation parenthetical ("Push Up (Knees)")
  // still contributes its tokens.
  const rule = RULES.find((r) => r.test.test(norm));

  const equipment = parsed.equipment;
  const fromEquip = loadTypeFromEquipment(equipment);

  let loadType: LoadType;
  if (ASSISTED.test(norm)) {
    loadType = 'assisted';
  } else if (rule?.loadType === 'duration' || rule?.loadType === 'distance') {
    // Timed/distance work overrides equipment: a weighted plank is still timed.
    loadType = rule.loadType;
  } else if (equipment === 'bodyweight') {
    // Strong's "(Bodyweight)" tag means the weight column is ADDED load, so
    // bodyweight-plus -- which collapses to plain bodyweight when weight is 0.
    loadType = 'bodyweight-plus';
  } else if (fromEquip !== null) {
    loadType = fromEquip;
  } else if (rule?.loadType) {
    loadType = rule.loadType;
  } else {
    // No parenthetical and no rule opinion: infer from what was actually logged.
    const o = opts.observedWeights;
    if (o && !o.anyNonZero && o.anyDistance) loadType = 'distance';
    else if (o && !o.anyNonZero && o.anySeconds) loadType = 'duration';
    else if (o && !o.anyNonZero) loadType = 'bodyweight-plus';
    else loadType = 'external';
  }

  const primary = rule?.primary ?? 'unknown';
  const secondary = (rule?.secondary ?? []).filter((m) => m !== primary);

  return {
    name: rawName.trim(),
    equipment,
    loadType,
    primaryMuscle: primary,
    secondaryMuscles: secondary,
    pattern: rule?.pattern ?? 'unknown',
    unilateral: rule?.unilateral ?? UNILATERAL.test(norm),
    confirmed: false,
  };
}
