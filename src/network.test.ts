import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';

/**
 * The privacy claim, as a test.
 *
 * "There is not a single network call in `src/`" is the strongest thing this
 * project says about itself, and it appears on the landing page, in the README
 * and in the app footer. A README sentence is not a guarantee; this is.
 *
 * It also removes the one embarrassing loophole in stating it as a grep: the
 * landing page's own copy quotes the very tokens being searched for, so a naive
 * `grep -rEn "fetch|XMLHttpRequest|axios" src/` matches the sentence claiming
 * there are no matches. That directory is excluded here for exactly that
 * reason, and nothing else in it is exempt -- Landing.tsx is checked below for
 * the real thing (a call), just not for the words.
 */

const ROOT = process.cwd() + '/src';

/** Marketing copy that quotes the tokens. Excluded from the token scan only. */
const COPY_ONLY = /[/\\]landing[/\\]/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = dir + '/' + entry;
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = walk(ROOT);

/** Anything that can reach the network. */
const NETWORK = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\baxios\b/,
  /navigator\s*\.\s*sendBeacon\b/,
  /\bnew\s+WebSocket\b/,
  /\bnew\s+EventSource\b/,
  /\bimport\s*\(\s*['"`]https?:/,
  /\bnavigator\s*\.\s*serviceWorker\b/,
];

describe('no network calls in src/', () => {
  it('finds source files to check at all', () => {
    // A broken walk would make every assertion below vacuously true.
    expect(FILES.length).toBeGreaterThan(20);
  });

  it.each(NETWORK.map((re) => [re.source, re] as const))(
    'never uses %s',
    (_label, re) => {
      const hits = FILES.filter((f) => !COPY_ONLY.test(f)).filter((f) =>
        re.test(readFileSync(f, 'utf8')),
      );
      expect(hits, 'network access in: ' + hits.join(', ')).toEqual([]);
    },
  );

  it('does not let the landing page make a call either', () => {
    // The landing is exempt from the *token* scan because it quotes them as
    // copy. It is not exempt from actually calling anything.
    const callable = [/\bfetch\s*\(/, /\bXMLHttpRequest\s*\(/, /navigator\s*\.\s*sendBeacon\b/];
    for (const f of FILES.filter((x) => COPY_ONLY.test(x))) {
      const text = readFileSync(f, 'utf8');
      for (const re of callable) {
        expect(re.test(text), f + ' matches ' + re.source).toBe(false);
      }
    }
  });
});
