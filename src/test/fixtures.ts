import { existsSync } from 'node:fs';

/**
 * Two corpora, deliberately.
 *
 * The SAMPLE is synthetic, committed, and what a fresh clone runs against.
 * The REAL export is one person's actual training history: it is gitignored and
 * never leaves the machine it was exported on. Suites that depend on it use
 * `hasRealFixture()` so they SKIP rather than fail when it is absent -- a skipped
 * test is visible in the runner output, a deleted one is not.
 */
export const SAMPLE_FIXTURE = 'fixtures/sample_workouts.csv';
export const REAL_FIXTURE = 'fixtures/strong_workouts.csv';

/** The measurements export, same synthetic/real split. */
export const SAMPLE_WEIGHT_FIXTURE = 'fixtures/sample_weight.csv';
export const REAL_WEIGHT_FIXTURE = 'fixtures/strong_weight.csv';

export function hasRealWeightFixture(): boolean {
  return existsSync(REAL_WEIGHT_FIXTURE);
}

export function hasRealFixture(): boolean {
  return existsSync(REAL_FIXTURE);
}
