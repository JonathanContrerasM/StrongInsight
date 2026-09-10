import { z } from 'zod';
import { EQUIPMENT, LOAD_TYPES, MOVEMENT_PATTERNS, MUSCLES, DEFAULT_SETTINGS } from './types';
import type { BodyweightEntry, ComparePerson, ExerciseMeta, RawImport, Settings } from './types';

/**
 * Zod guards PERSISTED records only -- never CSV rows. Running safeParse across
 * thousands of parsed rows would be a self-inflicted performance problem; the
 * parser narrows by hand and reports anomalies instead.
 *
 * Every schema here must DEGRADE, not throw: corrupt or schema-drifted values
 * fall back to a default and surface a warning rather than white-screening.
 */

const weightUnit = z.enum(['kg', 'lb']);

export const exerciseMetaSchema = z.object({
  name: z.string().min(1),
  equipment: z.enum(EQUIPMENT),
  loadType: z.enum(LOAD_TYPES),
  primaryMuscle: z.enum(MUSCLES),
  secondaryMuscles: z.array(z.enum(MUSCLES)).default([]),
  pattern: z.enum(MOVEMENT_PATTERNS),
  unilateral: z.boolean().default(false),
  aliasOf: z.string().optional(),
  confirmed: z.boolean().default(false),
});

export const exerciseMetaMapSchema = z.record(z.string(), exerciseMetaSchema);

export const bodyweightEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD'),
  kg: z.number().positive().finite(),
});

export const bodyweightSchema = z.array(bodyweightEntrySchema);

export const settingsSchema = z.object({
  inputUnit: weightUnit.default('kg'),
  displayUnit: weightUnit.default('kg'),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).default(1),
  defaultBodyweightKg: z.number().positive().finite().default(80),
});

export const rawImportSchema = z.object({
  text: z.string(),
  importedAt: z.number().finite(),
  filename: z.string(),
  // Older records predate the per-import unit stamp.
  unit: weightUnit.default('kg'),
});

export const rawArchiveSchema = z.array(rawImportSchema);

/**
 * The other person. `bodyweight` is deliberately left OUT of this object and
 * salvaged row by row in `readComparePerson` -- one bad weight reading must not
 * discard their export and their name along with it.
 */
export const comparePersonSchema = z.object({
  label: z.string().default(''),
  scale: z.enum(['absolute', 'relative']).default('absolute'),
  import: rawImportSchema.nullable().default(null),
});

export type ValidationWarning = { key: string; message: string };

/**
 * Parse a persisted value, falling back to `fallback` and recording a warning.
 * Returns the fallback for undefined WITHOUT warning -- absent is not corrupt.
 */
export function safeRead<T>(
  key: string,
  // Input is `unknown` on purpose: schemas here use .default(), which makes the
  // parsed-in shape looser than the parsed-out shape.
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  fallback: T,
  warnings: ValidationWarning[],
): T {
  if (value === undefined || value === null) return fallback;
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  warnings.push({
    key,
    message: result.error.issues
      .slice(0, 3)
      .map((i) => (i.path.length ? i.path.join('.') + ': ' : '') + i.message)
      .join('; '),
  });
  return fallback;
}

/**
 * Salvage what we can from a metadata map: one corrupt entry must not discard
 * every other tag the user has confirmed.
 */
export function readMetaMap(
  value: unknown,
  warnings: ValidationWarning[],
): Record<string, ExerciseMeta> {
  if (value === undefined || value === null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push({ key: 'meta:exercises', message: 'expected an object; ignored' });
    return {};
  }
  const out: Record<string, ExerciseMeta> = {};
  let dropped = 0;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const parsed = exerciseMetaSchema.safeParse(v);
    if (parsed.success) out[k] = parsed.data;
    else dropped++;
  }
  if (dropped > 0) {
    warnings.push({
      key: 'meta:exercises',
      message: dropped + ' entr' + (dropped === 1 ? 'y' : 'ies') + ' were corrupt and skipped',
    });
  }
  return out;
}

/** Same salvage policy for bodyweight: drop bad rows, keep good ones. */
export function readBodyweight(
  value: unknown,
  warnings: ValidationWarning[],
): BodyweightEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push({ key: 'meta:bodyweight', message: 'expected an array; ignored' });
    return [];
  }
  const out: BodyweightEntry[] = [];
  let dropped = 0;
  for (const v of value) {
    const parsed = bodyweightEntrySchema.safeParse(v);
    if (parsed.success) out.push(parsed.data);
    else dropped++;
  }
  if (dropped > 0) {
    warnings.push({
      key: 'meta:bodyweight',
      message: dropped + ' entr' + (dropped === 1 ? 'y' : 'ies') + ' were corrupt and skipped',
    });
  }
  return out;
}

export function readSettings(value: unknown, warnings: ValidationWarning[]): Settings {
  return safeRead('settings', settingsSchema, value, DEFAULT_SETTINGS, warnings);
}

export function readRawImport(
  key: string,
  value: unknown,
  warnings: ValidationWarning[],
): RawImport | null {
  return safeRead<RawImport | null>(key, rawImportSchema.nullable(), value, null, warnings);
}

export function readRawArchive(value: unknown, warnings: ValidationWarning[]): RawImport[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push({ key: 'raw:archive', message: 'expected an array; ignored' });
    return [];
  }
  const out: RawImport[] = [];
  for (const v of value) {
    const parsed = rawImportSchema.safeParse(v);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Salvage policy, as for metadata and bodyweight: keep whatever parses.
 *
 * The record is layered -- a corrupt `import` degrades to "named, no file"
 * rather than losing the person, and a corrupt weight row is dropped rather than
 * emptying the history.
 */
export function readComparePerson(
  value: unknown,
  warnings: ValidationWarning[],
): ComparePerson | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push({ key: 'compare:person', message: 'expected an object; ignored' });
    return null;
  }
  const record = value as Record<string, unknown>;

  const head = comparePersonSchema.safeParse({ ...record, bodyweight: undefined });
  let label = '';
  let scale: ComparePerson['scale'] = 'absolute';
  let rawImport: RawImport | null = null;
  if (head.success) {
    label = head.data.label;
    scale = head.data.scale;
    rawImport = head.data.import;
  } else {
    // Try again without the import: a broken export should not cost them a name.
    const withoutImport = comparePersonSchema.safeParse({
      ...record,
      bodyweight: undefined,
      import: null,
    });
    if (!withoutImport.success) {
      warnings.push({ key: 'compare:person', message: 'unreadable; ignored' });
      return null;
    }
    label = withoutImport.data.label;
    scale = withoutImport.data.scale;
    warnings.push({ key: 'compare:person', message: 'their export was corrupt and was dropped' });
  }

  const bodyweight: BodyweightEntry[] = [];
  let dropped = 0;
  if (Array.isArray(record.bodyweight)) {
    for (const v of record.bodyweight) {
      const parsed = bodyweightEntrySchema.safeParse(v);
      if (parsed.success) bodyweight.push(parsed.data);
      else dropped++;
    }
  } else if (record.bodyweight !== undefined && record.bodyweight !== null) {
    warnings.push({ key: 'compare:person', message: 'their bodyweight was not an array; ignored' });
  }
  if (dropped > 0) {
    warnings.push({
      key: 'compare:person',
      message:
        dropped +
        ' of their bodyweight entr' +
        (dropped === 1 ? 'y was' : 'ies were') +
        ' corrupt and skipped',
    });
  }

  if (label === '' && rawImport === null && bodyweight.length === 0) return null;
  return { label, scale, bodyweight, import: rawImport };
}
