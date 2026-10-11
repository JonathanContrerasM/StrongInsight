/**
 * Captures the landing page's screenshots: public/shots/<name>-<light|dark>.png.
 *
 * Builds the app, serves it with `vite preview`, and drives a locally installed
 * Chromium-family browser (Brave, Chrome or Chromium; override with $BROWSER)
 * over the DevTools protocol. Node's built-in WebSocket is the whole client, so
 * there is no Playwright and no Puppeteer -- the repo keeps its five runtime
 * dependencies and adds no dev ones.
 *
 * Reproducible by construction:
 *   - Data: the synthetic fixtures/sample_workouts.csv and sample_weight.csv,
 *     never a real export. Compare gets a second "person" derived from the same
 *     sample (each lift scaled by a fixed 0.72-1.08 picked from its name, every
 *     fifth session dropped), written to a temp file.
 *   - Clock: `new Date()` and `Date.now()` are pinned to FIXED_NOW, the morning
 *     after the sample's last session. Without that the sample is a years-old
 *     export and Recovery would open on its stale-export notice; with it the
 *     page reads the way it does for someone who trained yesterday. Every other
 *     tab counts to the last session, not the clock, so nothing else moves.
 *   - Viewport: 1440x1008, a common laptop width, at device scale 5/3, i.e.
 *     2400x1680 PNGs -- what the landing's <Shot> width/height declare.
 *   - Tags: the tray is shot while the sample's guessed tags are still pending,
 *     then they are all approved, so the other views are not stamped
 *     "100% unverified" by a fixture that simply ships without confirmations.
 *
 *   node scripts/make-screenshots.mjs
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'shots');
const WORKOUTS = join(ROOT, 'fixtures', 'sample_workouts.csv');
const WEIGHTS = join(ROOT, 'fixtures', 'sample_weight.csv');

const PREVIEW_PORT = 4179;
const DEBUG_PORT = 9339;
const BASE = `http://127.0.0.1:${PREVIEW_PORT}`;
/** The sample's last session ends 2023-05-19 ~19:05; this is the next morning, local time. */
const FIXED_NOW = new Date(2023, 4, 20, 9, 0, 0).getTime();
const WIDTH = 1440;
const HEIGHT = 1008;
const SCALE = 2400 / WIDTH;
const HEADER_PX = 64;

const BROWSERS = [
  process.env.BROWSER,
  '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
].filter(Boolean);

const children = [];
const temp = mkdtempSync(join(tmpdir(), 'stronginsight-shots-'));

function cleanup() {
  for (const c of children) {
    try {
      process.kill(-c.pid, 'SIGKILL');
    } catch {
      /* already gone */
    }
  }
  rmSync(temp, { recursive: true, force: true });
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(130));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function until(what, fn, timeoutMs = 20000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) throw new Error('timed out waiting for ' + what);
    await sleep(150);
  }
}

function start(cmd, args, opts = {}) {
  // Own process group, so cleanup takes the whole tree with it.
  const child = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: 'ignore', ...opts });
  children.push(child);
  return child;
}

// --- the second person for Compare -----------------------------------------------

/** Minimal RFC 4180 row split: quoted fields may hold commas and doubled quotes. */
function splitRow(line) {
  const out = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out;
}

function joinRow(cells) {
  return cells.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',');
}

function derivedExport() {
  const lines = readFileSync(WORKOUTS, 'utf8').split(/\r?\n/).filter((l) => l.length > 0);
  const header = splitRow(lines[0]);
  const wi = header.indexOf('Gewicht');
  const ni = header.indexOf('Name der Übung');
  // A stable per-lift factor, so "Sam" is stronger at some things and weaker at others.
  const factor = (name) => {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 0.72 + (h % 37) / 100;
  };
  const sessions = [...new Set(lines.slice(1).map((l) => splitRow(l)[0]))];
  const dropped = new Set(sessions.filter((_, i) => i % 5 === 4));
  const rows = lines
    .slice(1)
    .map(splitRow)
    .filter((r) => !dropped.has(r[0]))
    .map((r) => {
      const w = Number(r[wi]);
      if (Number.isFinite(w) && w > 0) r[wi] = (Math.round(w * factor(r[ni]) * 2) / 2).toFixed(1);
      return r;
    });
  const path = join(temp, 'sam_workouts.csv');
  writeFileSync(path, [joinRow(header), ...rows.map(joinRow)].join('\r\n'));
  return path;
}

// --- DevTools protocol ------------------------------------------------------------

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, fail) => {
    ws.onopen = ok;
    ws.onerror = () => fail(new Error('could not open ' + wsUrl));
  });
  let id = 0;
  const pending = new Map();
  ws.onmessage = (e) => {
    const msg = JSON.parse(typeof e.data === 'string' ? e.data : e.data.toString());
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.fail(new Error(p.method + ': ' + msg.error.message));
    else p.ok(msg.result);
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((ok, fail) => {
      const n = ++id;
      pending.set(n, { ok, fail, method });
      ws.send(JSON.stringify({ id: n, method, params, sessionId }));
      setTimeout(() => {
        if (pending.delete(n)) fail(new Error(method + ' timed out'));
      }, 30000);
    });
  return { send, close: () => ws.close() };
}

async function main() {
  console.log('building...');
  const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  if (build.status !== 0) throw new Error('build failed');

  start('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '127.0.0.1']);
  await until('vite preview', async () => (await fetch(BASE + '/app.html')).ok);

  const browser = BROWSERS.find((p) => existsSync(p));
  if (!browser) throw new Error('no Chromium-family browser found; set $BROWSER');
  start(browser, [
    '--headless=new',
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + join(temp, 'profile'),
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=' + WIDTH + ',' + HEIGHT,
    'about:blank',
  ]);
  const version = await until('browser', async () =>
    (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json(),
  );

  const cdp = await connect(version.webSocketDebuggerUrl);
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const send = (m, p) => cdp.send(m, p, sessionId);

  await send('Page.enable');
  await send('DOM.enable');
  await send('Runtime.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH,
    height: HEIGHT,
    deviceScaleFactor: SCALE,
    mobile: false,
  });

  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ': ' + expression);
    return r.result.value;
  };
  const waitFor = (what, expression, ms) => until(what, () => evaluate(expression), ms);
  const hasText = (t) => `document.body.textContent.includes(${JSON.stringify(t)})`;

  /** Put a file on the n-th file input in document order. */
  const setFile = async (path, nth = 0) => {
    await evaluate(
      `(() => { const i = document.querySelectorAll('input[type=file]')[${nth}]; i.setAttribute('data-shot', ''); return true; })()`,
    );
    const { root } = await send('DOM.getDocument', { depth: -1 });
    const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: 'input[data-shot]' });
    await send('DOM.setFileInputFiles', { nodeId, files: [path] });
    await evaluate(`document.querySelector('input[data-shot]').removeAttribute('data-shot'), true`);
  };

  let preload = null;
  const load = async (theme, hash) => {
    if (preload) await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: preload });
    ({ identifier: preload } = await send('Page.addScriptToEvaluateOnNewDocument', {
      source: `(() => {
        try { localStorage.setItem('stronginsight:theme', ${JSON.stringify(theme)}); } catch {}
        const FIXED = ${FIXED_NOW};
        const Real = Date;
        class Pinned extends Real {
          constructor(...a) { if (a.length === 0) super(FIXED); else super(...a); }
          static now() { return FIXED; }
        }
        globalThis.Date = Pinned;
      })();`,
    }));
    await send('Page.navigate', { url: 'about:blank' });
    await send('Page.navigate', { url: BASE + '/app.html' + hash });
    await waitFor('app shell', `!!document.querySelector('header nav')`);
  };

  const go = async (hash, ready) => {
    await evaluate(`(location.hash = ${JSON.stringify(hash)}, window.scrollTo(0, 0), true)`);
    await waitFor(hash, ready);
  };

  /** Scroll so the section headed `label` sits just under the sticky header. */
  const scrollToSection = (label) =>
    evaluate(`(() => {
      const b = [...document.querySelectorAll('section button[aria-expanded], section .hud-label')]
        .find((e) => e.textContent.trim() === ${JSON.stringify(label)});
      if (!b) return false;
      const top = b.closest('section').getBoundingClientRect().top + window.scrollY - ${HEADER_PX + 16};
      window.scrollTo(0, top);
      return true;
    })()`);

  const shoot = async (name, theme) => {
    // Two frames: the scroll and any lazy chunk have painted.
    await evaluate(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
    await sleep(250);
    const { data } = await send('Page.captureScreenshot', { format: 'png' });
    const file = join(OUT, `${name}-${theme}.png`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    console.log('  wrote', file.replace(ROOT + '/', ''));
  };

  // --- data, once: it lives in the temp profile's IndexedDB ------------------------
  console.log('importing the sample...');
  await load('light', '#import');
  await setFile(WORKOUTS, 0);
  await waitFor('import report', hasText('Import report'), 30000);
  // The bodyweight CSV input is the second file input once a history exists.
  await setFile(WEIGHTS, 1);
  await sleep(1000);
  await go('#compare', hasText("Their export"));
  await setFile(derivedExport(), 0);
  await waitFor('comparison', hasText('Lifts compared'), 30000);
  await evaluate(`(() => {
    const i = document.querySelector('input[placeholder="Them"]');
    if (!i) return true;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    set.call(i, 'Sam');
    i.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  // Their bodyweight, so their pull ups and dips can be compared too: the
  // second file input on Compare is their weight import.
  await setFile(WEIGHTS, 1);
  await sleep(1000);

  // The tray first, while it still has a queue to show.
  for (const theme of ['light', 'dark']) {
    await load(theme, '#tray');
    await go('#tray', hasText('Approve all'));
    await shoot('tagging-tray', theme);
  }
  await evaluate(`([...document.querySelectorAll('button')].find((b) => b.textContent.startsWith('Approve all')).click(), true)`);
  await waitFor('tags approved', `!document.body.textContent.includes('Approve all')`);

  for (const theme of ['light', 'dark']) {
    console.log(theme + ':');
    await load(theme, '#dashboard');

    await go('#dashboard', hasText('Records per month'));
    await shoot('dashboard', theme);
    await scrollToSection('Volume');
    await shoot('dashboard-charts', theme);

    await go('#improvements', hasText('What the data supports'));
    await shoot('improvements', theme);

    await go('#exercises/' + encodeURIComponent('Squat (Barbell)'), `document.querySelectorAll('svg').length > 6`);
    await shoot('exercise-detail', theme);

    await go('#compare', hasText('Lifts compared'));
    // Past the setup form, onto the comparison itself.
    await scrollToSection('What can actually be compared');
    await shoot('compare', theme);

    await go('#import', hasText('Import report'));
    await shoot('import', theme);

    await go('#recovery', `document.querySelectorAll('svg[aria-label^="Body,"]').length === 2`);
    await shoot('recovery', theme);
    await scrollToSection('Weekly volume');
    await shoot('recovery-history', theme);
  }

  cdp.close();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
