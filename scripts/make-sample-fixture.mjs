/**
 * Generates fixtures/sample_workouts.csv -- the corpus that ships with the repo.
 *
 * PURELY SYNTHETIC. It is not derived from anyone's real export, so no real
 * training pattern, date or personal record can leak through it.
 *
 * It is not arbitrary either: it deliberately reproduces every quirk the parser
 * and the test suite depend on. A sample missing the isometric-hold rows, say,
 * would let the most dangerous bug in the codebase back in without a single test
 * turning red. The checklist is in SAMPLE_QUIRKS below and is asserted by
 * src/ingest/sample.test.ts.
 *
 * Deterministic: fixed seed, no Date.now(), no Math.random(). Re-running it must
 * produce a byte-identical file, or the committed fixture would churn.
 *
 *   node scripts/make-sample-fixture.mjs
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '..', 'fixtures', 'sample_workouts.csv');

export const SAMPLE_QUIRKS = [
  'german headers',
  'CRLF line endings',
  'no BOM',
  'no trailing newline',
  'Ruhezeit rest rows',
  'a Ruhezeit row with seconds = 0',
  'W warm-up tokens',
  'D drop-set tokens',
  'isometric holds (reps 0, weight 0, seconds > 0, numeric set order)',
  'a trailing-space exercise name',
  'the (Dumbell) misspelling',
  'a non-equipment parenthetical, Push Up (Knees)',
  'a compound parenthetical, (Cable - Straight Bar)',
  'bodyweight-plus work at 0 and with added load',
  'empty-bar sets on an external exercise',
  'a set with load but zero reps',
  'a distance row',
  'push/pull/legs session structure',
  'a gap longer than 28 days',
];

/** Mulberry32 -- small, seeded, reproducible. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(20240101);

const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const jitter = (base, spread) => Math.round((base + (rand() - 0.5) * spread) * 2) / 2;

// --- the routine -------------------------------------------------------------
// Three distinct session types so the co-occurrence clustering has real
// structure to recover, plus shared accessories so it is not trivially separable.

const PUSH = [
  ['Bench Press (Barbell)', 60, 8],
  ['Incline Bench Press (Dumbbell)', 22, 10],
  ['Overhead Press (Barbell)', 35, 8],
  ['Lateral Raise (Dumbbell)', 9, 12],
  ['Triceps Pushdown (Cable - Straight Bar)', 25, 12],
  ['Push Up', 0, 15],
];
const PULL = [
  ['Pull Up', 0, 8],
  ['Seated Row (Cable)', 45, 10],
  ['Bicep Curl (Barbell)', 25, 10],
  ['Bicep Curl Bench (Dumbell)', 10, 12],
  ['Face Pull (Cable)', 20, 15],
];
const LEGS = [
  ['Squat (Barbell)', 70, 8],
  ['Leg Press', 110, 10],
  ['Leg Extension (Machine)', 40, 12],
  ['Standing Calf Raise (Bodyweight)', 0, 20],
  ['Single Leg Extension ', 20, 12], // trailing space, on purpose
];

const rows = [];
const push = (r) => rows.push(r);

function fmtDate(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getFullYear() +
    '-' + p(d.getMonth() + 1) +
    '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) +
    ':' + p(d.getMinutes()) +
    ':' + p(d.getSeconds())
  );
}

function label(hour) {
  if (hour < 11) return 'Morgen-Workout';
  if (hour < 14) return 'Mittags-Workout';
  if (hour < 17) return 'Nachmittags-Workout';
  return 'Abend-Workout';
}

let restRowsWithZero = 0;

/** One exercise block: optional warm-ups, working sets, rest rows between them. */
function emitExercise(date, workout, duration, name, baseWeight, baseReps, opts = {}) {
  const sets = opts.sets ?? 3 + Math.floor(rand() * 2);

  if (opts.warmup) {
    for (let w = 0; w < opts.warmup; w++) {
      push([date, workout, duration, name, 'W', jitter(baseWeight * 0.5, 4), baseReps, 0, 0]);
    }
  }

  for (let s = 1; s <= sets; s++) {
    if (opts.isometric) {
      // The critical case: structurally identical to a rest row except that the
      // set order is numeric. Reps and weight are zero; only seconds carry data.
      push([date, workout, duration, name, String(s), 0, 0, 0, 30 + s * 5]);
    } else if (opts.distance) {
      push([date, workout, duration, name, String(s), 0, 0, 1.5 + s * 0.25, 420 + s * 30]);
    } else if (opts.zeroReps && s === sets) {
      // Abandoned set: real load on the bar, no reps completed. Must carry a
      // non-zero weight or it is indistinguishable from a bodyweight set and the
      // report's zero-rep counter never sees it.
      push([date, workout, duration, name, String(s), opts.added || baseWeight || 20, 0, 0, 0]);
    } else if (opts.emptyBar && s === 1) {
      // Movement prep on an external exercise: a real set carrying no load.
      push([date, workout, duration, name, String(s), 0, baseReps, 0, 0]);
    } else {
      const weight = baseWeight === 0 ? (opts.added ?? 0) : jitter(baseWeight, baseWeight * 0.25);
      push([date, workout, duration, name, String(s), weight, Math.max(1, Math.round(baseReps + (rand() - 0.5) * 3)), 0, 0]);
    }

    // Rest row after most sets. One of them deliberately carries seconds = 0,
    // which only the localised-token path can classify.
    if (s < sets) {
      const zero = restRowsWithZero === 0 && rand() < 0.25;
      if (zero) restRowsWithZero++;
      push([date, workout, duration, name, 'Ruhezeit', 0, 0, 0, zero ? 0 : pick([60, 90, 120, 150])]);
    }
  }

  if (opts.dropset) {
    push([date, workout, duration, name, 'D', jitter(baseWeight * 0.6, 3), baseReps + 4, 0, 0]);
  }
}

// --- build the calendar ------------------------------------------------------
// Neutral dates, a plain rotation, and one deliberate layoff.

const start = new Date(2023, 0, 9, 18, 15, 0); // a Monday, neutral year
const plan = [PUSH, PULL, LEGS];
let dayOffset = 0;
let sessionIndex = 0;

for (let week = 0; week < 14; week++) {
  // A layoff of more than 28 days, so gap-segmenting has something to split on.
  if (week === 7) dayOffset += 35;

  for (let d = 0; d < 3; d++) {
    const date = new Date(start.getTime());
    date.setDate(date.getDate() + dayOffset + d * 2);
    date.setHours(17 + Math.floor(rand() * 3), Math.floor(rand() * 60), Math.floor(rand() * 60));

    const stamp = fmtDate(date);
    const workout = label(date.getHours());
    const mins = 45 + Math.floor(rand() * 40);
    const duration = mins >= 60 ? '1h ' + (mins - 60) + 'min' : mins + 'min';

    const block = plan[sessionIndex % 3];
    sessionIndex++;

    block.forEach(([name, weight, reps], i) => {
      const opts = {};
      if (i === 0) opts.warmup = 2;
      if (name === 'Squat (Barbell)' && week % 4 === 3) opts.emptyBar = true;
      if (name === 'Pull Up') {
        // Half bodyweight, half loaded -- the bodyweight-plus story.
        opts.added = week % 2 === 0 ? 0 : 5 + week;
        if (week === 5) opts.zeroReps = true;
      }
      if (name === 'Lateral Raise (Dumbbell)' && week % 5 === 2) opts.dropset = true;
      emitExercise(stamp, workout, duration, name, weight, reps, opts);
    });

    // Accessories that appear across session types, so clusters are not trivial.
    if (sessionIndex % 3 === 0) {
      emitExercise(stamp, workout, duration, 'Plank', 0, 0, { isometric: true, sets: 3 });
    }
    if (sessionIndex % 4 === 0) {
      emitExercise(stamp, workout, duration, 'Push Up (Knees)', 0, 12, { sets: 2 });
    }
    if (sessionIndex % 6 === 0) {
      emitExercise(stamp, workout, duration, 'Running', 0, 0, { distance: true, sets: 1 });
    }
  }
  dayOffset += 7;
}

// --- serialise ---------------------------------------------------------------

const HEADER =
  'Datum,Workout-Name,Dauer,Name der Übung,Reihenfolge festlegen,Gewicht,Wiederh.,Entfernung,Sekunden,Notizen,Workout-Notizen,RPE';

const q = (s) => '"' + String(s).replace(/"/g, '""') + '"';

const lines = rows.map(([date, workout, duration, name, order, weight, reps, dist, secs]) =>
  [
    date,
    q(workout),
    duration,
    q(name),
    order,
    Number(weight).toFixed(1),
    Number(reps).toFixed(1),
    dist,
    Number(secs).toFixed(1),
    '',
    '',
    '',
  ].join(','),
);

// CRLF throughout and NO trailing newline, exactly like a real Strong export.
const csv = [HEADER, ...lines].join('\r\n');

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, csv, 'utf8');

const restRows = rows.filter((r) => r[4] === 'Ruhezeit').length;
console.log('wrote ' + OUT);
console.log('  data rows   : ' + rows.length);
console.log('  rest rows   : ' + restRows);
console.log('  non-rest    : ' + (rows.length - restRows));
console.log('  workouts    : ' + new Set(rows.map((r) => r[0])).size);
console.log('  exercises   : ' + new Set(rows.map((r) => r[3])).size);
console.log('  ends with newline: ' + /\n$/.test(csv));
