# Design system

[&larr; back to the README](../README.md)

Semantic tokens defined once, mapped onto Tailwind utility names, and consumed as ordinary
utilities. There are no `slate-*` utilities and no hex literals anywhere in `src/` -- a lint-able
property, and one that `src/charts/palette.test.ts` enforces by parsing `index.css` directly rather
than asserting against a JavaScript copy that could drift.

This page also covers the nav rule for the empty app, the two Vite entries, and the URL hash.

See also [Architecture](architecture.md) for the layering rule that puts `ui/` below `charts/`.

---

## The design system, and dark mode

Everything visual resolves through semantic tokens defined once in `src/index.css`. There are no
`slate-*` utilities and no hex literals anywhere in `src/` — a lint-able property, and
`grep -rn --text -E "(text|bg|border)-(slate|amber|blue)-[0-9]" src` is expected to return nothing.
(The `--text` flag matters: `store/useWorkoutData.tsx` contains a literal NUL byte, so ripgrep
treats it as binary and skips it by default.)

**Three layers, and the order is the whole trick:**

1. `:root` and `:root.dark` define the raw `--c-*` and `--chart-*` values. These are the only
   things that change between themes.
2. `@theme inline { --color-surface: var(--c-surface); ... }` maps Tailwind utility names onto
   them. **The `inline` keyword is load-bearing** — a plain `@theme` block resolves its values at
   build time, which would bake the light palette into every utility and make the dark swap a
   silent no-op. With it, `bg-surface` compiles to `background-color: var(--c-surface)` and
   re-resolves at the use site.
3. Components use ordinary utilities (`bg-surface`, `text-dim`, `border-line`). Almost nothing in
   the app needs a `dark:` variant, because the tokens already swap themselves.

`:root.dark` rather than `.dark` is deliberate: both would be specificity (0,1,0) against the
`:root` block Tailwind also emits, leaving the swap dependent on source order.

**Theme selection** is Light / Dark / System, stored in `localStorage` under
`stronginsight:theme`. It is deliberately *not* part of `Settings`: settings load asynchronously
from IndexedDB, and anything read asynchronously arrives too late to prevent a white flash. An
inline script in `index.html` resolves the preference and stamps the class before first paint.
That class must go on `<html>` — the chart tooltip portals to `document.body`, outside the React
tree, and would otherwise stay light. Appearance is per-device and is not cleared by
*Reset everything*.

**Chart colour** is the same tokens by another route. `charts/colour.ts` emits
`var(--chart-*)` references rather than hex, so all 14 charts re-theme with no React plumbing and
no re-render. It still honours its original "testable in Node" contract: it *emits* variable
references, it never *reads* them, and every function stays a pure string mapping.

Two rules the palette must satisfy, both locked by `charts/palette.test.ts`:

- **Ramps are ordered least-intense to most-intense in both themes.** `quantileBinner` skips the
  weakest step so the lowest bin still reads as "trained", which is only meaningful if index 0
  really is the weakest. Light runs pale-to-deep and dark runs near-black-to-lime, so raw
  luminance moves in *opposite* directions — contrast against the surface is the invariant that
  holds for both.
- **The diverging midpoint is the quietest colour in its ramp.** Reusing the light ramp's
  near-white neutral on a near-black card would make "no imbalance" the loudest thing on screen.

That test parses `index.css` directly rather than asserting against a JavaScript copy, so it
cannot drift from what actually ships. It also checks WCAG contrast for every text token and
verifies that the hard-coded colours in the boot script still match `--c-canvas` — the one
unavoidable duplication in the system.

---

## The empty app

With nothing imported, the nav used to behave three different ways at once: Dashboard,
Improvements and Compare silently bounced you to Import — and the highlight jumped with you, so
clicking Dashboard looked like the app had ignored the click — while Exercises and the tagging
tray opened onto a dead end telling you to go back to Import.

The rule now lives once, in `ui/tabs.ts`: each tab carries a `needsData` flag and `tabEnabled`
is the only predicate. Data-dependent tabs render as genuinely `disabled` buttons with a title
explaining why, so keyboard and screen-reader semantics come for free. Note the styling avoids
`pointer-events-none`, which would suppress that tooltip — `disabled` already blocks the click.

The redirect guard in `App.tsx` survives as a *fallback* rather than the mechanism: nothing can
be clicked into an unusable state any more, but `hasData` can still go false underneath a live
tab when *Reset everything* runs. A test pins the exact set of locked tabs, so a tab added later
without a deliberate `needsData` decision fails rather than silently picking a behaviour.

---

## Two entries, and the theme boot script

The site root is a marketing page; the app is `app.html`.

```
index.html  ->  src/landing.tsx  ->  src/landing/Landing.tsx   the landing page, at /
app.html    ->  src/main.tsx     ->  src/App.tsx               the app, at /app.html
```

Both are declared in `vite.config.ts` under `build.rollupOptions.input`. The dev server needs
nothing extra -- Vite serves multiple entries out of the box.

The landing is a **React entry sharing the app's stylesheet and primitives**, not hand-written HTML.
That is the whole reason it costs nothing to keep in sync: it imports `src/index.css` and
`src/ui/primitives.tsx`, so it uses the same tokens, the same `Card` / `Tile` / `Button`, and the
same `ThemeControl`. There is no second palette to drift, and dark mode required no extra code. It
renders from nothing -- no provider, no IndexedDB, no CSV -- which is what lets it be the first
paint and what lets `src/landing/Landing.test.tsx` mount it bare.

`src/ui/BrandMark.tsx` exists for the same reason: two headers need the mark, and a hand-copied
second set of four `<rect>`s is exactly the kind of thing that drifts.

**The boot script is now in both HTML files, and that duplication is checked.** It has to be inline
to beat first paint, so it cannot be shared as a module. `src/charts/palette.test.ts` therefore reads
**every `.html` in the repo root** rather than naming one, asserts the hard-coded canvas colours
still match `--c-canvas` in each, and asserts the class is stamped on `documentElement`. A third
entry added later is covered without anyone remembering to come back.

## The URL hash

The app is still one page with navigation state, not a router. But the landing has to be able to link
at a section, and the browser Back button has to be able to retrace every step -- so that state has an
address:

```ts
// src/ui/tabs.ts
export type Route = { tab: Tab; detail: string | null };
export const DEFAULT_ROUTE: Route;                       // { tab: 'dashboard', detail: null }
export function routeFromHash(hash: string): Route | null;
export function hashForRoute(tab: Tab, detail?: string | null): string;
```

```
#compare                              -> { tab: 'compare',   detail: null }
#exercises                            -> { tab: 'exercises', detail: null }
#exercises/Bench%20Press%20(Barbell)  -> { tab: 'exercises', detail: 'Bench Press (Barbell)' }
```

`App` holds **one** piece of navigation state seeded from `location.hash`, listens for `hashchange`,
and writes the hash in one place (`goTo`) so the URL can never disagree with the view. Assigning a
hash equal to the current one does not fire `hashchange`, so that write cannot loop.

**The rule that earns its keep: every view state reachable by clicking must be addressable.** Tabs
alone were not enough, and the gap was a real bug. Tab and open lift were separate state, and only
the tab was ever written to the hash -- so opening an exercise from the table pushed *no history
entry*, and Back skipped the list entirely to land on whatever tab preceded it. Putting the lift in
the hash fixes that and makes a lift bookmarkable and shareable as a side effect.

Details that are load-bearing:

- **It does not bypass `tabEnabled`.** `/app.html#compare` with nothing imported falls through the
  same guard a click does and lands on Import. The hash is deliberately left stale in that case, so
  a reload once data exists arrives where the link asked. A test pins that the two rules stay
  separate.
- **An unrecognised hash returns `null`,** never a throw and never an arbitrary tab. The caller
  substitutes `DEFAULT_ROUTE`, which is what makes Back to a bare `/app.html` show the same thing a
  cold load of `/app.html` shows. Those two used to disagree: the mount defaulted to the dashboard
  while the `hashchange` handler ignored an unrecognised hash and froze the view.
- **The name is percent-encoded, and the route splits on the first `/` only.** Encoding turns any
  slash inside a name into `%2F`, so the split cannot be ambiguous. Exercise names are whatever the
  user typed into Strong -- the reference corpus carries `deadhang`, `katana` and one name with a
  trailing space -- so nothing about them can be assumed.
- **`decodeURIComponent` throws on a mangled escape** like `%zz`. That is caught and returns `null`,
  so a hand-edited URL degrades instead of taking the app down on mount.
- **A detail segment is refused on any tab but `exercises`**, rather than being silently ignored.
- **The in-app back link pops, it does not push.** `history.back()`, guarded by a ref recording
  whether this session pushed an entry of its own -- someone who landed straight on
  `#exercises/Bench Press` from a bookmark or a reload has nothing of ours behind them, so they get a
  push instead of being ejected from the app. Pushing unconditionally would make browser Back appear
  to go *forward*, back onto the lift just left.

Back and forward now work throughout the app.
