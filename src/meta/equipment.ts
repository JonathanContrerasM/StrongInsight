import type { Equipment, LoadType } from '../model/types';

/**
 * Strong encodes equipment in a trailing parenthetical: "Bench Press (Barbell)".
 *
 * Two traps in real data:
 *  - it is sometimes MISSPELLED -- "(Dumbell)" with one b
 *  - it is not always equipment -- "Push Up (Knees)" is a variation
 * so an unrecognised parenthetical must NOT be forced into an equipment slot.
 */

export type ParsedName = {
  /** Name with the trailing parenthetical removed, e.g. "Bench Press". */
  base: string;
  /** Raw parenthetical contents, or null when there was none. */
  parenthetical: string | null;
  equipment: Equipment;
  /** True when a parenthetical existed but named something other than equipment. */
  parentheticalIsVariation: boolean;
};

const EQUIPMENT_ALIASES: Array<[RegExp, Equipment]> = [
  [/^barbell$/, 'barbell'],
  [/^(ez|ez[ -]?bar|hammer[ -]?bar|straight[ -]?bar|trap[ -]?bar|smith(?:[ -]machine)?)$/, 'barbell'],
  // "Dumbell" (one b) appears in real exports.
  [/^(dumbb?ell?|db)$/, 'dumbbell'],
  [/^machine$/, 'machine'],
  [/^(plate[ -]?loaded|hammer[ -]?strength|sled|lever)$/, 'machine'],
  [/^cable/, 'cable'], // also matches "cable - straight bar"
  [/^(bodyweight|body[ -]?weight|bw)$/, 'bodyweight'],
  [/^kettlebell$/, 'kettlebell'],
  [/^plate$/, 'plate'],
  [/^(band|resistance[ -]?band)$/, 'band'],
];

function normalise(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

/** Split a trailing "(...)" off an exercise name and classify it. */
export function parseExerciseName(rawName: string): ParsedName {
  const name = rawName.trim();
  const m = /^(.*?)\s*\(([^()]*)\)\s*$/.exec(name);

  if (!m) {
    return { base: name, parenthetical: null, equipment: 'unknown', parentheticalIsVariation: false };
  }

  const base = (m[1] ?? '').trim();
  const paren = (m[2] ?? '').trim();
  const key = normalise(paren);

  for (const [re, eq] of EQUIPMENT_ALIASES) {
    if (re.test(key)) {
      return { base, parenthetical: paren, equipment: eq, parentheticalIsVariation: false };
    }
  }

  // A parenthetical we don't recognise as equipment is a VARIATION ("Knees"),
  // not an excuse to guess. Leave equipment unknown for the heuristics to fill.
  return { base, parenthetical: paren, equipment: 'unknown', parentheticalIsVariation: true };
}

export function parseEquipment(rawName: string): Equipment {
  return parseExerciseName(rawName).equipment;
}

/** Equipment alone determines load type only for these. */
export function loadTypeFromEquipment(eq: Equipment): LoadType | null {
  switch (eq) {
    case 'barbell':
    case 'dumbbell':
    case 'machine':
    case 'cable':
    case 'kettlebell':
    case 'plate':
    case 'band':
      return 'external';
    case 'bodyweight':
      return 'bodyweight';
    default:
      return null;
  }
}
