import { z } from 'zod';
import { EQUIPMENT, LOAD_TYPES, MOVEMENT_PATTERNS, MUSCLES, DEFAULT_SETTINGS } from './types';
import type { BodyweightEntry, ExerciseMeta, RawImport, Settings } from './types';

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
