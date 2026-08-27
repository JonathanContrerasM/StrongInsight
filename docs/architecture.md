# Architecture

[&larr; back to the README](../README.md)

How the app is layered, what may import what, where the memoisation lives, and what is persisted.
The short version: parsing never depends on metadata, `derive/` is pure, and the raw CSV text is
what gets stored -- never the parsed result.

See also [The CSV, and its traps](ingest.md) for what the parser is up against, and
[Design system](design-system.md) for the UI layers below `views/`.

---

## Architecture

### Parsing never depends on metadata

`src/ingest/**` must not import from `src/meta/**` or `src/store/**`. If it did, every keystroke
in the tagging tray would re-parse 6,517 CSV rows.

So `parseCsv` emits `ParsedSet` (`SetRecord` minus `isUnloaded`, which needs a `loadType`), and a
separate cheap `enrichSets` pass applies metadata to produce the full model. That pass is the only
place that already walks every set with metadata in hand, so it also resolves aliases and computes
effective load — which keeps every `derive/` function a plain `(sets, metaIndex) => T`.

### The memo graph

One hook, `src/store/useWorkoutData.tsx`, mounted once and shared by context. Without it each view
builds its own chain and parses twice.

```
[M1] parsed    = useMemo(parseCsv(text, {unit}), [text, unit])   <- deps: text + unit ONLY
[M2] observed  = useMemo(..., [parsed.sets])  -> feeds the auto-extension effect
[M3] metaIndex = useMemo(buildMetaIndex(meta), [meta])           <- flattens aliases
[M4] bwAt      = useMemo(..., [bodyweight, defaultBodyweightKg])
[M5] sets      = useMemo(enrichSets(parsed.sets, metaIndex, bwAt), [...])
```

`unit` is the **import-time** unit stamped on `raw:current`, never `settings.displayUnit` — those
must stay separate or toggling the display unit re-parses the corpus. Weight is stored in kg
everywhere; lb is a render-time concern.

New exercise names are auto-extended into the metadata map by one effect, with three guards:

1. **Hydration race (the dangerous one)** — if the effect ran before IndexedDB hydration resolved,
   `meta` would be `{}`, every name would look new, and the user's confirmed tags would be
   overwritten with guesses. The effect is inert unless `status !== 'loading'`.
2. **Effect loop** — deps are the name-set key and status only; current metadata is read through a
   ref. It returns before touching state when nothing is missing, and the merge returns `prev` by
   identity when nothing changed, so React bails out.
3. **StrictMode double-invoke** — all IndexedDB writes for a key are serialised through
   `withLock(key, fn)`, and the merge is idempotent.

### Persistence: store the raw CSV, never the parsed result

```
idb:
  raw:current     -> { text, importedAt, filename, unit }
  raw:archive     -> last 5 imports (ring buffer, written under the same lock)
  meta:exercises  -> Record<string, ExerciseMeta>
  meta:bodyweight -> { date, kg }[]
  settings        -> { inputUnit, displayUnit, weekStartsOn, defaultBodyweightKg }
```

Parsing 6.5k rows takes a few milliseconds, so caching the result is not worth it. The payoff is
that **improving the parser reprocesses existing data with no re-export**, and archived imports
allow rollback if a rename mangles history.

The unit is recorded **per import** rather than globally. Strong rewrites its entire history when
its unit setting changes, so any one export is internally consistent — but an archived export may
be in different units than the current one. Tagging each import prevents a silent 2.2× error.

Everything read back is Zod-validated and **degrades rather than throws**: a corrupt metadata entry
is dropped while the rest survive, and every failure surfaces as a warning banner.

### Metadata: no hardcoded exercise list anywhere

Three layers, in order:

1. **Equipment from the trailing parenthetical** (`src/meta/equipment.ts`), with misspelling
   normalisation and variation detection.
2. **Token heuristics** (`src/meta/guessMeta.ts`) — an ordered rule table over the name. Two
   orderings are load-bearing and have already caused bugs: `leg curl` must precede the generic
   `curl` rule (or `Seated Leg Curl` resolves to *biceps*), and `farmer`/`carry` must precede the
   cardio rule (or `Farmer Walk` becomes a *distance* exercise because of the word "walk").
3. **A seed map** (`src/meta/seedMeta.ts`) covering the top 40 exercises by set count — 85.7% of
   all sets. It is an **overlay, not a gate**: entries ship `confirmed: false`, a name absent from
   it falls through to the guesser, and no code branches on membership.

Against the real corpus this leaves only **4 of 130** names without a guessed muscle — all
genuinely un-guessable (`Gylenhall Rotation`, `katana`, `V Tuck`, `Sally Challange`). Those flow
straight to the tagging tray, which is exactly the designed path.

Anything unconfirmed renders with a visible `unverified` marker wherever it appears, so a wrong
guess can never silently distort a future chart.

Aliases are flattened once in `buildMetaIndex` with path compression, cycle detection and a hop
cap. Cycles and dangling targets produce non-throwing warnings. **No `derive/` function ever reads
`aliasOf`** — grouping is always on `canonicalName`.

---

## Layout

```
src/
  ingest/   sniffDelimiter, headerMap, classifyRow, parseCsv, parseDuration, report
  model/    types, schemas (Zod), effectiveLoad (+ enrichSets), bodyweight
  meta/     equipment, guessMeta, seedMeta, metaIndex
  store/    idb (withLock), useWorkoutData (the memo graph)
  derive/   e1rm (Epley + Brzycki), volume, setCounts  -- PURE, no React, no IO
  views/    Import, TaggingTray, ExerciseList, Settings
```

`derive/` is what every future chart and insight rule will be written against, so it stays pure
and trivially unit-testable. `volume()` returns `{ volumeKg, includedSets, excludedSets, ... }`
rather than a bare number, so a future chart can explain a dip instead of plotting a silent zero.
`e1rm` special-cases a single (the raw Epley formula returns 103.3 for 100×1) and returns `null`
past 12 reps, where both formulas become fiction.

---

## Tests

200 tests across nine files, of which 171 run on a fresh clone and 29 skip with the personal export
absent. Beyond the unit tests, `src/ingest/sample.test.ts` locks the synthetic corpus and
`src/ingest/fixture.test.ts` holds regression
locks measured from the real export — row counts, the W/D split, the 81 surviving isometric holds,
Pull Up's 437/186 bodyweight-versus-loaded split, the 36 empty-bar squats — plus structural
invariants (dense `setOrder` per exercise, unique ids, `setIds` consistency) and a re-import
determinism check.

**Those constants live only in test files.** No application code contains a fixture-derived
number, so any other Strong export parses on its own terms.

---

## Performance

Measured on the real corpus: `parseCsv` 65 ms, `enrichSets` 2.5 ms, `calendarDays` 6 ms,
`volumeMatrix` 12 ms, clustering with auto-threshold 130 ms.

The clustering is the only expensive step, and it is memoised on a **session signature** (the
sorted canonical names per workout) rather than on `sets` or `meta`. Canonical names change only
when an *alias* changes, so editing a muscle tag never re-runs it — and `enrichSets`, which does
re-run, costs 2.5 ms.
