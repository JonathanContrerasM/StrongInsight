import type { WeightUnit } from './model/types';

const KG_TO_LB = 1 / 0.45359237;

export function toDisplayWeight(kg: number, unit: WeightUnit): number {
  return unit === 'lb' ? kg * KG_TO_LB : kg;
}

/** Weight is stored in kg everywhere; conversion happens only at render time. */
export function formatWeight(kg: number | null, unit: WeightUnit, digits = 1): string {
  if (kg === null || !Number.isFinite(kg)) return '-';
  return toDisplayWeight(kg, unit).toFixed(digits) + ' ' + unit;
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
