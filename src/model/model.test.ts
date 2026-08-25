import { describe, it, expect } from 'vitest';
import { effectiveLoad } from './effectiveLoad';
import { bodyweightAt, makeBodyweightResolver, mergeBodyweight } from './bodyweight';
import type { BodyweightEntry } from './types';

describe('effectiveLoad', () => {
  const bw = 80;

  it('resolves all six load types', () => {
    expect(effectiveLoad({ loadType: 'external', weightKg: 100, bodyweightKg: bw })).toBe(100);
    expect(effectiveLoad({ loadType: 'bodyweight', weightKg: 0, bodyweightKg: bw })).toBe(80);
    expect(effectiveLoad({ loadType: 'bodyweight-plus', weightKg: 20, bodyweightKg: bw })).toBe(100);
    expect(effectiveLoad({ loadType: 'assisted', weightKg: 20, bodyweightKg: bw })).toBe(60);
    expect(effectiveLoad({ loadType: 'duration', weightKg: 0, bodyweightKg: bw })).toBeNull();
    expect(effectiveLoad({ loadType: 'distance', weightKg: 0, bodyweightKg: bw })).toBeNull();
  });

  it('treats a bodyweight-plus set with no added load as plain bodyweight', () => {
    expect(effectiveLoad({ loadType: 'bodyweight-plus', weightKg: 0, bodyweightKg: bw })).toBe(80);
    expect(effectiveLoad({ loadType: 'bodyweight-plus', weightKg: null, bodyweightKg: bw })).toBe(80);
  });

  it('never lets assistance drive load negative', () => {
    expect(effectiveLoad({ loadType: 'assisted', weightKg: 200, bodyweightKg: bw })).toBe(0);
  });

  it('returns null when a bodyweight-relative type has no bodyweight', () => {
    expect(effectiveLoad({ loadType: 'bodyweight', weightKg: 0, bodyweightKg: null })).toBeNull();
    expect(effectiveLoad({ loadType: 'bodyweight-plus', weightKg: 20, bodyweightKg: null })).toBeNull();
    expect(effectiveLoad({ loadType: 'assisted', weightKg: 20, bodyweightKg: null })).toBeNull();
  });

  it('passes a null external weight through as unknown, not zero', () => {
    expect(effectiveLoad({ loadType: 'external', weightKg: null, bodyweightKg: bw })).toBeNull();
  });
});

describe('bodyweightAt', () => {
  const entries: BodyweightEntry[] = [
    { date: '2024-01-01', kg: 80 },
    { date: '2024-01-11', kg: 90 },
  ];
  const at = (iso: string) => bodyweightAt(entries, new Date(iso + 'T12:00:00'));

  it('returns the exact value on a recorded date', () => {
    expect(at('2024-01-01')).toBe(80);
    expect(at('2024-01-11')).toBe(90);
  });

  it('interpolates linearly between entries', () => {
    expect(at('2024-01-06')).toBeCloseTo(85, 6);
    expect(at('2024-01-03')).toBeCloseTo(82, 6);
  });

  it('clamps outside the recorded range at both ends', () => {
    expect(at('2020-01-01')).toBe(80);
    expect(at('2030-01-01')).toBe(90);
  });

  it('sorts unordered input before interpolating', () => {
    const shuffled: BodyweightEntry[] = [
      { date: '2024-01-11', kg: 90 },
      { date: '2024-01-01', kg: 80 },
    ];
    expect(bodyweightAt(shuffled, new Date('2024-01-06T12:00:00'))).toBeCloseTo(85, 6);
  });

  it('falls back rather than silently computing zero when nothing is recorded', () => {
    const r = makeBodyweightResolver([], 75);
    expect(r(new Date('2024-01-01'))).toBe(75);
    expect(r.isFallback).toBe(true);
    expect(r.entryCount).toBe(0);

    const none = makeBodyweightResolver([], null);
    expect(none(new Date('2024-01-01'))).toBeNull();
  });

  it('ignores corrupt entries', () => {
    const messy: BodyweightEntry[] = [
      { date: 'not-a-date', kg: 1 },
      { date: '2024-01-01', kg: 80 },
      { date: '2024-01-05', kg: Number.NaN },
    ];
    const r = makeBodyweightResolver(messy, null);
    expect(r.entryCount).toBe(1);
    expect(r(new Date('2024-06-01'))).toBe(80);
  });
});

describe('mergeBodyweight', () => {
  const manual: BodyweightEntry[] = [
    { date: '2024-01-01', kg: 80 },
    { date: '2024-02-01', kg: 82 },
  ];

  it('keeps hand-entered dates the import does not cover', () => {
    const out = mergeBodyweight(manual, [{ date: '2024-03-01', kg: 84 }]);
    expect(out).toEqual([
      { date: '2024-01-01', kg: 80 },
      { date: '2024-02-01', kg: 82 },
      { date: '2024-03-01', kg: 84 },
    ]);
  });

  it('lets the import win a collision on the same day', () => {
    const out = mergeBodyweight(manual, [{ date: '2024-02-01', kg: 99 }]);
    expect(out).toHaveLength(2);
    expect(out.find((e) => e.date === '2024-02-01')?.kg).toBe(99);
  });

  it('returns entries sorted by date whatever order they arrived in', () => {
    const out = mergeBodyweight(
      [{ date: '2024-05-01', kg: 85 }],
      [
        { date: '2024-01-15', kg: 81 },
        { date: '2024-03-02', kg: 83 },
      ],
    );
    expect(out.map((e) => e.date)).toEqual(['2024-01-15', '2024-03-02', '2024-05-01']);
  });

  it('leaves the inputs untouched', () => {
    const imported = [{ date: '2024-02-01', kg: 99 }];
    mergeBodyweight(manual, imported);
    expect(manual).toHaveLength(2);
    expect(manual[1]?.kg).toBe(82);
    expect(imported).toHaveLength(1);
  });
});
