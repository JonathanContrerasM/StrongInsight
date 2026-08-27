# Analysis decisions

[&larr; back to the README](../README.md)

The visualisation and insight layer, and the reasoning behind each choice that could have gone the
other way. Most of this page is about **refusals**: the clustering that declines to draw three boxes
around noise, the weakness engine that suppresses what it cannot distinguish from chance, and the
comparison that names what it will not compare.

See also [The CSV, and its traps](ingest.md) for the model all of this is written against.

---

## Iteration 2 — the visualisation layer

Charts are hand-rolled SVG. **No charting dependency was added**: four of the five heatmaps are
`<rect>` grids that chart libraries handle badly, and the only part of a library genuinely worth
having is a handful of scales, which are ~150 lines that now live in the pure, tested half of the
codebase.

```
src/ui/       design tokens made concrete: Card, Tile, Button, Field, Badge, theme  -- imports nothing but React
src/charts/   scale, colour, ChartFrame + HoverLayer, parts (axes, tooltip, legends)  -- no domain knowledge
src/viz/      the charts themselves: derive output -> chart primitives
src/derive/   buckets, stats, series, balance, profile, cooccurrence  -- all PURE
src/store/useAnalytics.ts   corpus-wide memos, strictly below the existing M1-M5 graph
```

`src/charts/` must never import **domain types** from `model/`. If a primitive needs to know what
a `Muscle` is, it is in the wrong layer. Pure maths is fine and is why `colour.ts` and `parts.tsx`
import from `derive/stats`.

`src/ui/` sits strictly below `charts/`: it holds the generic, domain-free chrome that views and
charts both need, so neither has to reach into the other for a button.

---

## The recovered training split

The most useful thing in the app, and it exists because of a limitation documented above: Strong's
workout names are auto-generated time-of-day labels, so the routine is invisible in the export.
But *which exercises share a session* is not.

Exercises are clustered by session co-occurrence, which reconstructs the split actually being run.
On the reference corpus it cleanly recovers **Push** (Bench, Incline, Chest Fly, Triceps, OHP,
Dips), **Pull** (Pull Up, Chin Up, Muscle Up, Curls, Rows, Face Pull) and **Legs** (Squat,
Deadlift, Leg Press, Lunges, Calf Raises) from 199 sessions all labelled "Abend-Workout".

Decisions worth keeping:

- **Cosine (Ochiai), not Jaccard.** Measured on the real corpus, cosine wins on *both* separation
  and coverage: silhouette **0.190 over 71 exercises** versus **0.132 over 56**. Jaccard penalises
  the frequency asymmetry between a staple lift and the accessories that always accompany it, so
  it recovers "things I do often" rather than "things I do together".
- **Average-linkage agglomerative clustering** on `1 - similarity`. Single linkage chains
  everything into one blob on sparse data; complete linkage fragments it. Deterministic given a
  name-sorted index, which a test asserts by re-running on reversed input.
- **The appearance threshold is measured, not assumed.** `pickThreshold` scores candidates by
  `silhouette × coverage ÷ (1 + singletons)`. Silhouette alone is biased toward discarding every
  hard case — raising the threshold always tightens what remains — and on this corpus that bias
  threw away 96 of 130 exercises to gain a little separation.
- **It refuses rather than confabulates.** Below a silhouette of 0.12 the UI says the split is
  *not well separated* instead of drawing three confident boxes around noise.
- **Clustering touches no metadata at all**; only the cluster *names* do. So a bad tag can rename a
  group but can never corrupt the grouping — and the UI says so.

---

## Traps found in the data, and how the charts avoid them

**A "fatigue curve" would have been backwards.** Mean load *rises* across set positions, because
this athlete ramps up within their numbered sets:

| Exercise | set 1 | set 2 | set 3 | set 4 | set 5 |
|---|---|---|---|---|---|
| Squat (Barbell) | 14 kg | 36 kg | 60 kg | 73 kg | 81 kg |
| Bench Press (Barbell) | 27 kg | 55 kg | 70 kg | 75 kg | 73 kg |

Only where load is pinned at bodyweight does falling reps mean fatigue (`Push Up`: 13.0 → 11.5 →
9.3). So `setPositionProfile` returns reps **and** load, plus a `shape` of `ramping` /
`straight` / `fatiguing`, and the chart says which it is.

**Monthly top-set weight is noise.** It swings by more than 2x for a barbell squat because ramp sets and deloads
share a bucket. Progression is therefore computed **per session**, smoothed with a rolling
**median** (a mean is dragged down by one-sided deload outliers), and the line **breaks across
gaps over 28 days** rather than drawing invented progress through a layoff. A test asserts median
beats mean on synthetic deload data, so nobody "simplifies" it to a moving average later.

**Volume is heavily right-skewed** — `p25 2,346 / median 4,506 / p90 11,070 / max 24,898`, with
`p10 = 0` because roughly a tenth of sessions are pure bodyweight. Colour scales are therefore
**quantile-binned over the user's own history**, and the legend prints real values so a shade is
never read as an absolute amount.

**Three calendar states, not two.** Untrained, trained-with-no-countable-load, and trained. Letting
a rest day share a fill with the lowest volume bin is the classic calendar-heatmap lie.

**The muscle heatmap defaults to row-relative, not absolute.** On absolute volume it only ever says
"legs are heavy" — squat volume dwarfs lateral raises, every upper-body row goes pale, and the
chart carries no information. Row-relative asks the useful question instead. The active mode is
labelled loudly, because a diverging scale mistaken for an absolute one is genuinely misleading.

**Balance is plotted as `log2(ratio)`.** On a raw ratio axis 2:1 sits at 2.0 and 1:2 at 0.5, so
half the range is squashed into `[0,1]` and equal-and-opposite imbalances look wildly different.
A missing side yields `null`, never `Infinity` or `0`.

**Time-of-day may not exist.** Strong's date column has an optional time component; an export
without one puts every session at midnight and draws a dramatic fake spike. `habitMap` reports
`hasTimeOfDay` and the chart falls back to a weekday breakdown.

**Day arithmetic is date-based, never `+86400000`.** Epoch-ms stepping drops or duplicates a day
across a DST boundary, and this range spans several.

---

## Per-session peaks: why it is two series, not one

Clicking any row in **Exercises** opens that exercise's full history. Among its charts, *"Per
session: heaviest load and volume"* plots two facets on a shared time axis rather than one line,
because the two measurements genuinely disagree:

Measured across the reference export, the session with the **highest total volume** was frequently
not the session with the **heaviest set** — for barbell squats the biggest workload day was done at
under half the peak load, months apart from it.

A single line would have had to pick one of those stories and silently discard the other, and a
dual axis would have implied an alignment between kilograms and total volume that does not exist —
so they get separate facets.

Heaviest-per-session is the noisier series by nature (squat runs 80, 90, 80, 60, 90, **40**, 90 …)
because deload days sit in it alongside top sets; the smoother workload series beside it is what
makes those dips interpretable. The load line breaks across layoffs over 28 days rather than
bridging them — Squat splits into 6 segments (gaps of 47, 42, 38, 60 and 42 days), Pull Up into 3.

Note that "heaviest" is **effective** load, so a weighted pull up reads as bodyweight plus the
added plates, not as the small number in the raw weight column. Because heaviest is now a first-class series
here, the *Strength progression* card above it plots estimated 1RM alone rather than showing the
same data twice.

---

## Metadata honesty in charts

The iteration-1 promise — an unverified tag is visible wherever it appears — is kept concretely:
an amber ring on any heatmap cell that is ≥25% unverified, a clickable *"N% unverified tags"* chip
on every metadata-grouped chart that jumps to the Tagging tray, `unknown` always present as an
explicit category pinned last rather than dropped, and the `volume()` exclusion breakdown printed
under the volume chart. The calendar, co-occurrence matrix, habit map, progression and density
charts depend on **no** metadata, which is worth knowing when judging what survives a bad tag.

---

## The Improvements tab: refusing to confabulate

A weakness engine finds weaknesses whether or not any exist. Search seven weekdays for the one
you train least and one of them always comes last; search 34 lifts for a stall and several
always look stalled. The measured weekday rates on the reference corpus, against an overall
28.1%:

| | Sat | Fri | Wed | Mon | Tue | Sun | Thu |
|---|---|---|---|---|---|---|---|
| rate | 5.0% | 16.8% | 25.7% | 28.7% | 38.2% | 40.6% | 41.6% |
| z | **-5.18** | -2.52 | -0.53 | +0.14 | +2.28 | +2.79 | **+3.01** |

Saturday is a real hole. **Monday and Wednesday are indistinguishable from noise**, and a naive
version of this feature would report "you tend to skip Wednesdays" with a straight face. So
`src/derive/insights.ts` reports, for every rule, a z *and* the size of the test family it was
searched within, and one `gate()` decides what the user ever sees:

- **clear** survives a Bonferroni correction across the family — |z| >= 2.69 among seven
  weekdays, 3.18 among 34 lifts.
- **suggestive** clears the ordinary 1.96 bar but not that one, and is labelled as such.
- Anything below is **suppressed**, counted, and never shown.

Three counters are surfaced in the UI rather than hidden, because they are the feature's
credibility: patterns tested, suppressed as too weak, and tested-and-fine. A weekly-frequency
decline from 2.04 to 1.86 sessions looks real and is not (z ~ 0.9); it is suppressed, and a test
asserts that it stays suppressed.

Two framing decisions worth keeping:

- **It measures training rate, not skipping.** Someone running Tue/Thu/Sun by design has not
  skipped Saturday. And past half the week, untrained days fold into one observation —
  "your training sits on Mondays, Wednesdays and Fridays" — because four separate cards about a
  three-day split are four accusations aimed at the programme itself.
- **No dependence on "now".** `derive/` forbids dates-from-now, so "abandoned" is measured
  against the last session in the corpus. That is also simply more correct: against a CSV
  exported three months ago, wall-clock recency would call every lift in it abandoned.

Findings that are *facts* rather than inferences — a lift genuinely untouched for 119 days —
carry `z: null` and bypass the gate explicitly, so the gate cannot quietly become decorative.

---

## The Compare tab: two people, and what does not compare

Upload another person's export and compare it against your own. Most of what you would naturally
compare is meaningless, and saying so is the feature.

Measured by splitting the reference corpus in half and treating the halves as two people — the
friendliest possible case, one person and one exercise vocabulary — overlap was **0.48 Jaccard**,
and after every gate only **19 of 63 shared exercises** were comparable at all. Between two
different people it is worse.

**Three refusals**, each surfaced in the UI with its reason rather than folded into an average:

- **Machine and cable loads are not a shared unit.** 60 kg on one manufacturer's stack is not
  60 kg on another's, and a cable's label depends on the pulley ratio. Only free weights and
  bodyweight mean the same thing in two different gyms. On the split corpus this removed 18 of
  the 63 shared lifts.
- **Equipment is often not stated at all.** Strong only names it in a trailing parenthetical, so
  `Leg Press` and `Triceps Extension` both infer `equipment: 'unknown'` — one is a machine, one
  might be a dumbbell, and neither can be verified. 13 more lifts.
- **Bodyweight movements need both bodyweights.** A pull up logged at zero load is a different
  amount of work for two different people, and the workout export does not carry it. Note the
  gate order: `loadType` is checked *before* `equipment`, because `Pull Up`, `Chest Dip` and
  `Muscle Up` all infer `equipment: 'unknown'` while correctly inferring `bodyweight-plus` —
  checking equipment first files every one of them as a machine.

**The headline number is the median session best, not the personal best.** A max is a maximum
over a sample, so it climbs with the number of attempts logged rather than with strength.
Subsampling the reference corpus 400 times per sample size:

| Squat sessions sampled | max | median session best |
|---|---|---|
| 5 | 123.1 | 107.4 |
| 20 | 129.8 | 107.9 |
| 51 (all) | 133.3 | 108.0 |

The max drifts 4.4–8.8% across the three biggest lifts; the median does not move. Comparing a
five-year export against a one-year one on PRs would flatter the longer history for nothing. The
PR is still shown, beside its session count, labelled as context.

Everything about training *shape* — sessions per week, sets per session, volume per week, share
of volume by muscle, rep ranges — needs no normalisation between two people and is compared as
rates, never totals. So is "what they train and you don't", which is the one output that needs no
matching, no units, and no bodyweight.

The second corpus is **never persisted**: it is somebody else's training history, so there is no
IndexedDB key and no `sessionStorage`. It does survive moving between tabs, because App unmounts
each view on navigation and losing the file every time you glanced at the dashboard was
untenable — so it lives in a module-level store (`store/compareCorpus.ts`, the same shape as
`ui/theme.ts`) rather than component state. Being a plain module variable is what makes a reload
clear it, with no code required. The store holds **raw inputs only**, down to the bodyweight
field being kept as the typed string rather than a parsed number: a controlled number input bound
to a parsed value eats the decimal point while you are still typing `78.5`.

It also gets its own metadata map rather than the store's — partly so their exercises stay out of
your tag table and tagging tray, and partly for correctness, since the store's lazy resolver
would guess their unseen names without the observed-weights hint and resolve bodyweight movements
to `external`.

One hazard worth knowing: set and workout ids are content hashes of date plus name, and Strong's
workout names are auto-generated time-of-day labels, so **two people who trained the same evening
produce the same `workoutId`**. The two set arrays are never pooled or keyed together, which is
what keeps that harmless.

---

## Out of scope in this iteration

Volume landmarks, body diagrams, DuckDB/SQL, any backend or sync. Linked brushing is limited to a date range; full crossfilter and
re-clustering on a brushed subset are deliberately deferred — the latter is unstable across brush
positions and reads as a bug. Where a decision would constrain later work, the code carries a
`// FUTURE:` comment rather than building ahead of scope.
