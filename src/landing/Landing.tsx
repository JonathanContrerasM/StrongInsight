import type { ReactNode } from 'react';
import { BrandMark, Wordmark } from '../ui/BrandMark';
import { ThemeControl } from '../ui/ThemeControl';
import { Badge, LinkButton, SectionLabel, Tile } from '../ui/primitives';
import { APP, Arrow, Claim, FeatureRow, Shot, Step } from './parts';

/**
 * The marketing page at `/`. The app is at `/app.html`.
 *
 * Two rules govern everything below.
 *
 * 1. It renders from nothing. No provider, no IndexedDB, no CSV -- which is what
 *    lets it be the first paint a visitor gets, and what lets the render test
 *    mount it with no setup at all.
 * 2. Every number on this page is one that can be checked. The counts come from
 *    the test suite and package.json; the measurements (31% of sets at
 *    bodyweight, 19 of 63 comparable lifts) come from the reference corpus and
 *    are documented in `docs/`. Nothing here is a round number invented to look
 *    good, because the whole pitch of the app is that it refuses to invent
 *    numbers.
 */

const GITHUB = 'https://github.com/JonathanContrerasM/StrongInsight';
const DOCS = GITHUB + '/blob/main/';

const NAV = [
  { href: '#why', label: 'Why' },
  { href: '#tour', label: 'Features' },
  { href: '#privacy', label: 'Privacy' },
  { href: '#stack', label: 'Under the hood' },
];

export function Landing() {
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Header />

      <main className="flex-1">
        <Hero />
        <Why />
        <Tour />
        <Privacy />
        <Stack />
        <GetStarted />
      </main>

      <Footer />
    </div>
  );
}

// --- chrome -------------------------------------------------------------------

/** Deliberately the same skeleton as the app header, so the two read as one product. */
function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-14 w-full max-w-[100rem] items-center gap-3 px-4 sm:px-6">
        <a href="#top" className="flex items-center gap-2.5">
          <BrandMark />
          <Wordmark />
        </a>

        <nav className="ml-4 hidden items-center gap-1 md:flex" aria-label="Sections">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="rounded-md px-3 py-1.5 text-sm font-medium text-dim transition-colors hover:text-ink"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <span className="hud-label hidden lg:inline">local only</span>
          <ThemeControl size="sm" />
          <LinkButton href={APP} variant="primary" size="sm">
            Open the app
          </LinkButton>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const links = [
    [APP, 'Open the app'],
    [GITHUB, 'GitHub'],
    [DOCS + 'README.md', 'Docs'],
    [DOCS + 'LICENSE', 'MIT'],
  ];
  return (
    <footer className="mx-auto w-full max-w-[100rem] px-4 pb-10 pt-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-line pt-4">
        <span className="hud-label">StrongInsight</span>
        <span className="text-xs text-faint">
          Every calculation runs in this browser. Your export is never uploaded.
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          {links.map(([href, label]) => (
            <a key={label} href={href} className="text-dim transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}

/** One consistent page gutter. Narrower than the app shell: this is prose, not a grid of charts. */
function Section({
  id,
  className = '',
  children,
}: {
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className={'scroll-mt-14 ' + className}>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">{children}</div>
    </section>
  );
}

function Heading({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl text-center">
      <SectionLabel>{eyebrow}</SectionLabel>
      <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h2>
      {children && (
        <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-dim">{children}</p>
      )}
    </div>
  );
}

// --- sections -----------------------------------------------------------------

function Hero() {
  return (
    <section id="top" className="scroll-mt-14">
      <div className="mx-auto w-full max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-20">
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="accent" dot className="mb-5">
            Nothing leaves this browser
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-6xl">
            Every set you&rsquo;ve logged,
            <br />
            <span className="text-accent-ink">read properly.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-dim sm:text-lg">
            StrongInsight turns a Strong CSV export into the analysis the app itself never shows
            you &mdash; real volume with bodyweight counted, the training split it can recover from
            sessions that are all just called &ldquo;Evening Workout&rdquo;, and weaknesses that
            have to survive a significance test before you ever see them.
          </p>

          {/*
           * One app CTA, not two. "See the dashboard" used to sit beside this
           * and pointed at `#dashboard` -- which, for anyone arriving here for
           * the first time, falls through `tabEnabled` and lands on Import,
           * byte-identical to the button next to it. Two buttons doing the same
           * thing is bad; a button labelled "dashboard" that shows an import
           * prompt is worse on a page whose whole argument is that it does not
           * overclaim. The secondary is now an in-page anchor, which is honest
           * whether or not anything has been imported.
           */}
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <LinkButton href={APP + '#import'} variant="primary">
              Open the app
              <Arrow />
            </LinkButton>
            <LinkButton href="#tour">See what it does</LinkButton>
          </div>

          <p className="mt-4 text-xs text-faint">
            No account. No backend. No upload. Free and{' '}
            <a className="text-dim underline underline-offset-2 hover:text-ink" href={GITHUB}>
              open source
            </a>
            .
          </p>
        </div>

        <div className="mt-12">
          <Shot
            priority
            src="/shots/dashboard-light.png"
            darkSrc="/shots/dashboard-dark.png"
            alt="Dashboard"
            width={2400}
            height={1680}
          />
        </div>

        {/*
         * Four figures, all checkable. "0 network calls" is the load-bearing one:
         * it is the entire privacy claim, and src/network.test.ts is what keeps
         * it true rather than aspirational.
         */}
        <div className="mt-6 grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Tile label="Network calls in src/" value="0" tone="accent" hint="there is no backend" />
          <Tile label="Runtime dependencies" value="5" hint="no charting library" />
          <Tile label="Tests" value="360" hint="across 17 files" />
          <Tile label="Charts" value="14" hint="hand-rolled SVG" />
        </div>
      </div>
    </section>
  );
}

function Why() {
  return (
    <Section id="why" className="border-y border-line bg-sunken">
      <Heading eyebrow="Why it is different" title="Four things it refuses to get wrong">
        Each of these is a place where the obvious implementation produces a confident, wrong
        answer. Every figure below was measured against a real 6,517-row export, not assumed.
      </Heading>

      <div className="mt-8 grid gap-3 md:grid-cols-2">
        <Claim n="01" title="Bodyweight is real load">
          31% of working sets in the reference export carry weight&nbsp;0. Treat weight as absolute
          and a third of that training computes to zero volume, with the most-trained movement of
          all &mdash; the pull up &mdash; rendered invisible. Load resolves per set against a
          bodyweight history, so a weighted pull up reads as bodyweight plus the belt rather than as
          the belt alone.
        </Claim>
        <Claim n="02" title="Your split is recovered, not guessed">
          Strong names every session after the time of day, so your routine is nowhere in the
          export. But which exercises share a session is. Clustering on session co-occurrence
          recovers Push, Pull and Legs from 199 workouts all labelled the same thing &mdash; and
          where separation is genuinely poor it says the split is not well separated instead of
          drawing three confident boxes around noise.
        </Claim>
        <Claim n="03" title="Weaknesses pass a significance gate">
          Search seven weekdays for the one you train least and one of them always comes last. Every
          finding carries a z-score and the size of the family it was searched within, and only what
          survives a Bonferroni correction is reported as clear. What got suppressed is counted and
          shown to you, because that number is the feature&rsquo;s credibility.
        </Claim>
        <Claim n="04" title="Bad comparisons are refused, and named">
          Compare two exports and most of what you would naturally compare is meaningless.
          60&nbsp;kg on one manufacturer&rsquo;s stack is not 60&nbsp;kg on another&rsquo;s; a
          bodyweight movement needs both bodyweights. On the friendliest possible test only 19 of 63
          shared exercises were comparable at all &mdash; and each refusal is shown with its reason
          rather than folded into an average.
        </Claim>
      </div>
    </Section>
  );
}

function Tour() {
  return (
    <Section id="tour">
      <Heading eyebrow="The app" title="Five places to look" />

      <div className="mt-12 space-y-16 sm:space-y-24">
        <FeatureRow
          eyebrow="Dashboard"
          title="The whole corpus, at a glance"
          href={APP + '#dashboard'}
          cta="Open the dashboard"
          shot={
            <Shot
              src="/shots/dashboard-charts-light.png"
              darkSrc="/shots/dashboard-charts-dark.png"
              alt="Volume and balance"
              width={2400}
              height={1680}
            />
          }
        >
          <p>
            Volume, sessions, sets and consistency across the whole export, then a training calendar
            with three states rather than two &mdash; untrained, trained with no countable load, and
            trained. Colour scales are quantile-binned over your own history and the legend prints
            real values, so a shade is never read as an absolute amount.
          </p>
          <p>
            Below that: the recovered split, volume over time stacked by muscle or movement pattern,
            a balance chart plotted as log2 of the ratio so equal-and-opposite imbalances look
            equal, and a muscle heatmap that defaults to row-relative &mdash; on absolute volume it
            only ever says &ldquo;legs are heavy&rdquo;.
          </p>
        </FeatureRow>

        <FeatureRow
          flip
          eyebrow="Improvements"
          title="A weakness engine that can say nothing"
          href={APP + '#improvements'}
          cta="See how it gates"
          shot={
            <Shot
              src="/shots/improvements-light.png"
              darkSrc="/shots/improvements-dark.png"
              alt="Improvements"
              width={2400}
              height={1680}
            />
          }
        >
          <p>
            Findings across consistency, progression, and neglect and balance &mdash; each ranked,
            each carrying its z-score. A weekly frequency decline from 2.04 to 1.86 sessions looks
            real and is not. It gets suppressed, and a test asserts that it stays suppressed.
          </p>
          <p>
            Three counters sit in the open: patterns tested, suppressed as too weak, and
            tested-and-fine. Findings that are facts rather than inferences &mdash; a lift genuinely
            untouched for 119 days &mdash; bypass the gate explicitly, so the gate cannot quietly
            become decorative.
          </p>
        </FeatureRow>

        <FeatureRow
          eyebrow="Exercises"
          title="Every lift, and then one lift in full"
          href={APP + '#exercises'}
          cta="Browse the exercises"
          shot={
            <Shot
              src="/shots/exercise-detail-light.png"
              darkSrc="/shots/exercise-detail-dark.png"
              alt="Exercise detail"
              width={2400}
              height={1680}
            />
          }
        >
          <p>
            A sortable table of everything you have logged, and behind any row the full history:
            estimated 1RM, per-session heaviest load and volume as two facets rather than one line,
            a load-versus-reps density map, and the set-position profile.
          </p>
          <p>
            That last one would have been backwards as a &ldquo;fatigue curve&rdquo;. Mean load{' '}
            <em>rises</em> across set positions here, because this athlete ramps up within their
            numbered sets &mdash; so the chart reports the shape it actually found: ramping,
            straight or fatiguing. Progression lines break across layoffs over 28 days rather than
            drawing invented progress through a gap.
          </p>
        </FeatureRow>

        <FeatureRow
          flip
          eyebrow="Compare"
          title="Two people, and what does not compare"
          href={APP + '#compare'}
          cta="Try a comparison"
          shot={
            <Shot
              src="/shots/compare-light.png"
              darkSrc="/shots/compare-dark.png"
              alt="Compare"
              width={2400}
              height={1680}
            />
          }
        >
          <p>
            Drop in a second person&rsquo;s export. Training <em>shape</em> &mdash; sessions per
            week, sets per session, share of volume by muscle, rep ranges &mdash; needs no
            normalisation between two people and is compared as rates, never totals.
          </p>
          <p>
            Loads are another matter, and the headline number is the median session best rather than
            the personal best: a max climbs with the number of attempts logged, so comparing a
            five-year export against a one-year one on PRs would flatter the longer history for
            nothing. Their export is never persisted &mdash; no IndexedDB key, no sessionStorage,
            gone on reload.
          </p>
        </FeatureRow>

        <FeatureRow
          eyebrow="Import and tagging"
          title="Nothing is silently dropped"
          href={APP + '#import'}
          cta="Import an export"
          shot={
            <Shot
              src="/shots/import-light.png"
              darkSrc="/shots/import-dark.png"
              alt="Import report"
              width={2400}
              height={1680}
            />
          }
        >
          <p>
            Drop the CSV and you get a report, not a spinner: row counts, the warm-up and drop-set
            split, every unrecognised token with its verbatim value and file line number, and the
            traps found in your own data. Localised headers are handled through an alias table, so a
            German or English export parses with no code change.
          </p>
          <p>
            Exercise metadata starts as a guess from the name, and anything unconfirmed renders with
            a visible <em>unverified</em> marker wherever it appears &mdash; so a wrong guess can
            never silently distort a chart. The tagging tray queues what still needs you,
            highest-set-count first.
          </p>
        </FeatureRow>
      </div>
    </Section>
  );
}

const PRIVACY: [string, string][] = [
  ['No account, no backend, no telemetry.', 'There is not a single network call in src/.'],
  [
    'Your export stays in your browser.',
    'The raw CSV is kept in IndexedDB on your own device so it survives a reload. Clearing site data removes it.',
  ],
  [
    'The raw text is stored, never the parsed result.',
    'So improving the parser reprocesses your existing data with no re-export, and the last five imports can be rolled back.',
  ],
  [
    'A second person’s export is never persisted at all.',
    'It lives in a module variable, so a reload clears it with no code required.',
  ],
  ['Reset everything means everything.', 'One button in Settings drops every stored key.'],
];

function Privacy() {
  return (
    <Section id="privacy" className="border-y border-line bg-sunken">
      <div className="grid gap-8 lg:grid-cols-2 lg:gap-12">
        <div>
          <SectionLabel>Privacy</SectionLabel>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-ink sm:text-3xl">
            There is no server to send it to
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-dim">
            A Strong export is years of training history with exact timestamps. That is personal
            health and routine data, so the app is built so that uploading it is not something it{' '}
            <em>can</em> do. That is not a policy in a document &mdash; it is a property you can
            check for yourself:
          </p>
          <pre className="num mt-4 overflow-x-auto rounded-lg border border-line bg-surface p-3 text-xs text-ink">
            <code>
              $ npm test -- network{'\n'}
              {'✓'} no network calls in src/ (10 tests){'\n'}
            </code>
          </pre>
          <p className="mt-3 text-xs leading-relaxed text-faint">
            <code className="num text-dim">src/network.test.ts</code> walks every source file and
            fails on a fetch, a request object, a beacon, a socket or a remote import. It is a test
            rather than a grep for an honest reason: this page quotes those words, so grepping{' '}
            <code className="num text-dim">src/</code> for them finds the sentence saying there is
            nothing to find.
          </p>
        </div>

        <ul className="space-y-3 text-sm leading-relaxed text-dim">
          {PRIVACY.map(([title, body]) => (
            <li key={title} className="flex gap-3">
              <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>
                <strong className="font-semibold text-ink">{title}</strong> {body}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </Section>
  );
}

const STACK = [
  { label: 'Framework', value: 'React 19', hint: 'Vite 6, TypeScript strict' },
  { label: 'Runtime deps', value: '5', hint: 'papaparse, idb-keyval, zod, react, react-dom' },
  { label: 'Charts', value: '14', hint: 'hand-rolled SVG, no charting library' },
  { label: 'Styling', value: 'Tailwind v4', hint: 'semantic tokens, no hex in src/' },
  { label: 'Storage', value: 'IndexedDB', hint: 'Zod-validated, degrades rather than throws' },
  { label: 'Tests', value: '360', hint: 'across 17 files, green in CI on every push' },
];

const DOC_LINKS: [string, string][] = [
  ['docs/ingest.md', 'The CSV, and its traps'],
  ['docs/architecture.md', 'Architecture'],
  ['docs/analysis.md', 'Analysis decisions'],
  ['docs/design-system.md', 'Design system'],
];

function Stack() {
  return (
    <Section id="stack">
      <Heading eyebrow="Under the hood" title="Small, pure, and written down">
        Parsing never depends on metadata, every derive function is a pure{' '}
        <code className="num rounded bg-sunken px-1 py-0.5 text-ink">(sets, meta) =&gt; T</code>{' '}
        with no React and no IO, and every decision that could have gone the other way is written
        down rather than lost.
      </Heading>

      <div className="mt-8 grid grid-cols-2 gap-2 lg:grid-cols-3">
        {STACK.map((s) => (
          <Tile key={s.label} label={s.label} value={s.value} hint={s.hint} />
        ))}
      </div>

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {DOC_LINKS.map(([path, label]) => (
          <LinkButton key={path} href={DOCS + path} size="sm">
            {label}
            <Arrow />
          </LinkButton>
        ))}
      </div>
    </Section>
  );
}

function GetStarted() {
  return (
    <Section className="border-t border-line bg-sunken">
      <Heading eyebrow="Get started" title="Three steps, about a minute" />

      <div className="mx-auto mt-8 grid max-w-4xl gap-3 sm:grid-cols-3">
        <Step
          n="01"
          title="Export from Strong"
          body="Settings, then Export Data. Strong emails you a CSV."
        />
        <Step
          n="02"
          title="Drop it on the page"
          body="Parsed in-page. No upload, no account, no backend."
        />
        <Step
          n="03"
          title="Confirm the tags"
          body="Exercise metadata starts as a guess. The tray shows what still needs you."
        />
      </div>

      <div className="mt-8 text-center">
        <LinkButton href={APP + '#import'} variant="primary">
          Open the app
          <Arrow />
        </LinkButton>
        <p className="mt-4 text-xs text-faint">
          No export handy? The repository ships a synthetic one at{' '}
          <code className="num rounded bg-surface px-1 py-0.5 text-ink">
            fixtures/sample_workouts.csv
          </code>
          .
        </p>
      </div>
    </Section>
  );
}
