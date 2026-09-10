// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BodyweightEditor } from './BodyweightEditor';
import type { BodyweightEntry } from '../model/types';
import { SAMPLE_WEIGHT_FIXTURE } from '../test/fixtures';

/**
 * The shared bodyweight editor, driven the way a person drives it: pick a file,
 * then delete rows.
 *
 * The behaviour worth pinning is that the import report retires itself. It
 * describes the history it produced, so once that history changes -- a row
 * deleted here, or the list cleared by the caller -- leaving "5 entries
 * imported" above an empty table states something that is no longer true.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WEIGHT_CSV = readFileSync(SAMPLE_WEIGHT_FIXTURE, 'utf8');
// Covers the fixture's real readings, and excludes the 2019 one it carries on
// purpose -- a measurements export predates training by years.
const SPAN = { from: new Date(2022, 0, 1), to: new Date(2024, 0, 1) };

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** Stateful host, because the component is controlled and the test edits it. */
function Host({ initial = [] as BodyweightEntry[] }) {
  const [entries, setEntries] = useState(initial);
  return (
    <div>
      <button type="button" data-testid="clear" onClick={() => setEntries([])}>
        clear from outside
      </button>
      <BodyweightEditor entries={entries} onChange={setEntries} span={SPAN} unit="kg" />
    </div>
  );
}

function text(): string {
  return container.textContent ?? '';
}

/**
 * The LAST table on the page. The import report renders a table of refused rows
 * above the history, so a bare `tbody tr` would sometimes count those instead.
 */
function historyRows(): Element[] {
  const tables = [...container.querySelectorAll('table')];
  const last = tables[tables.length - 1];
  return last ? [...last.querySelectorAll('tbody tr')] : [];
}

/**
 * jsdom has no DataTransfer, so the FileList cannot be built the way a browser
 * builds it -- the input's `files` is redefined on the instance instead, then a
 * bubbling native change event is dispatched for React to pick up at the root.
 */
async function pickFile(name: string, body: string) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  const file = new File([body], name, { type: 'text/csv' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => {
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // The handler awaits file.text(); one more flush lands the state it sets.
  await act(async () => {});
}

describe('BodyweightEditor', () => {
  it('imports a measurements export and accounts for every row', async () => {
    await act(async () => root.render(<Host />));
    await pickFile('strong_weight.csv', WEIGHT_CSV);

    expect(text()).toContain('strong_weight.csv');
    expect(text()).toContain('rows read');
    // The reading from before training started is reported, not silently kept.
    expect(text()).toContain('outside the training period');
    expect(historyRows().length).toBeGreaterThan(0);
  });

  /** The reported bug: the report outlived the entries it was describing. */
  it('retires the import report when a row is deleted', async () => {
    await act(async () => root.render(<Host />));
    await pickFile('strong_weight.csv', WEIGHT_CSV);
    expect(text()).toContain('rows read');

    const del = historyRows()[0]?.querySelector('button') as HTMLButtonElement;
    await act(async () => del.click());

    expect(text()).not.toContain('rows read');
    expect(text()).not.toContain('strong_weight.csv');
  });

  it('retires it when the caller clears the history from outside', async () => {
    await act(async () => root.render(<Host />));
    await pickFile('strong_weight.csv', WEIGHT_CSV);
    expect(text()).toContain('rows read');

    const clear = container.querySelector('[data-testid="clear"]') as HTMLButtonElement;
    await act(async () => clear.click());

    expect(text()).not.toContain('rows read');
    expect(historyRows()).toHaveLength(0);
  });

  /**
   * The one case where the report must SURVIVE: nothing was kept, so the
   * history did not change, and the report is the only thing explaining why.
   */
  it('keeps the report when an import produced nothing', async () => {
    await act(async () => root.render(<Host />));
    await pickFile('empty.csv', 'Datum,Measurement Type,Value,Unit\n');

    expect(text()).toContain('Nothing was imported from empty.csv');
  });
});
