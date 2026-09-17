import { describe, expect, it } from 'vitest';
import { formatLoad, formatLoadSplit, formatWeight } from './format';
import type { LoadParts } from './model/effectiveLoad';

const plus: LoadParts = { loadType: 'bodyweight-plus', totalKg: 120, bodyweightKg: 80, addedKg: 40 };
const bw: LoadParts = { loadType: 'bodyweight', totalKg: 80, bodyweightKg: 80, addedKg: 0 };
const assisted: LoadParts = { loadType: 'assisted', totalKg: 60, bodyweightKg: 80, addedKg: -20 };

describe('formatLoad', () => {
  it('prints the total once with the split beside it', () => {
    expect(formatLoad(plus, 120, 'kg')).toBe('120.0 kg (80.0 bw + 40.0)');
    expect(formatLoad(bw, 80, 'kg')).toBe('80.0 kg (bw)');
    expect(formatLoad(assisted, 60, 'kg')).toBe('60.0 kg (80.0 bw − 20.0)');
  });

  it('falls back to the plain weight without parts', () => {
    expect(formatLoad(null, 100, 'kg')).toBe(formatWeight(100, 'kg'));
    expect(formatLoad(null, null, 'kg')).toBe('-');
  });

  it('converts every number, not just the total', () => {
    expect(formatLoad(plus, 120, 'lb', 0)).toBe('265 lb (176 bw + 88)');
    expect(formatLoadSplit(plus, 'lb', 0)).toBe('176 bw + 88');
  });
});
