import type { WeightUnit } from './model/types';
import type { LoadParts } from './model/effectiveLoad';

const KG_TO_LB = 1 / 0.45359237;

export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kg * KG_TO_LB : kg;
}

/** Weight is stored in kg everywhere; conversion happens only at render time. */
export function formatWeight(kg: number | null, unit: WeightUnit, digits = 1): string {
  if (kg === null || !Number.isFinite(kg)) return '-';
  return toDisplayWeight(kg, unit).toFixed(digits) + ' ' + unit;
}

/**
 * A load with its bodyweight split beside it, where there is one:
 * "120.0 kg (80.0 bw + 40.0)", "80.0 kg (bw)", "60.0 kg (80.0 bw \u2212 20.0)".
 * Without parts it is just the total, so callers pass both unconditionally.
 * The unit is printed once, on the total.
 */
export function formatLoad(
  parts: LoadParts | null,
  totalKg: number | null,
  unit: WeightUnit,
  digits = 1,
): string {
  if (parts === null) return formatWeight(totalKg, unit, digits);
  return formatWeight(parts.totalKg, unit, digits) + ' (' + formatLoadSplit(parts, unit, digits) + ')';
}

/** Just the bracketed half of formatLoad: "80.0 bw + 40.0". */
export function formatLoadSplit(parts: LoadParts, unit: WeightUnit, digits = 1): string {
  const n = (kg: number) => toDisplayWeight(kg, unit).toFixed(digits);
  if (parts.loadType === 'bodyweight') return 'bw';
  const sign = parts.addedKg < 0 ? ' \u2212 ' : ' + ';
  return n(parts.bodyweightKg) + ' bw' + sign + n(Math.abs(parts.addedKg));
}

export function formatVolume(kg: number, unit: WeightUnit): string {
  const v = toDisplayWeight(kg, unit);
  if (v >= 1000) return (v / 1000).toFixed(1) + 't';
  return Math.round(v).toLocaleString() + ' ' + unit;
}

export function formatDate(d: Date | null): string {
  if (!d || Number.isNaN(d.getTime())) return '-';
  const p = (n: number) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

export function formatDuration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec) || sec <= 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  if (h > 0) return m > 0 ? h + 'h ' + m + 'min' : h + 'h';
  return m + 'min';
}

/** YYYY-MM-DD in local time, for bodyweight entry keys. */
export function toDateInput(d: Date): string {
  return formatDate(d);
}
