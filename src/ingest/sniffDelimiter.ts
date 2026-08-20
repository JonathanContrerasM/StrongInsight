/**
 * Strong has shipped comma, semicolon and tab variants, so the delimiter is
 * sniffed rather than assumed. Chooses the candidate that yields the most
 * consistent field count across the first N lines.
 */

export const CANDIDATE_DELIMITERS = [',', ';', '\t'] as const;
export type Delimiter = (typeof CANDIDATE_DELIMITERS)[number];

/** Split one CSV line, honouring double-quoted fields (with "" escapes). */
function countFields(line: string, delim: string): number {
  let fields = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && ch === delim) {
      fields++;
    }
  }
  return fields;
}

export function splitLines(text: string, limit = Infinity): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < text.length && out.length < limit; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') {
        cur += '""';
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      cur += ch;
      continue;
    }
    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      // Consume CRLF as a single terminator.
      if (ch === '\r' && text[i + 1] === '\n') i++;
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.length > 0 && out.length < limit) out.push(cur);
  return out;
}

export type SniffResult = { delimiter: Delimiter; fieldCount: number; confident: boolean };

export function sniffDelimiter(text: string, sampleLines = 20): SniffResult {
  const lines = splitLines(text, sampleLines).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { delimiter: ',', fieldCount: 1, confident: false };

  let best: SniffResult | null = null;

  for (const delim of CANDIDATE_DELIMITERS) {
    const counts = lines.map((l) => countFields(l, delim));
    const header = counts[0] ?? 1;
    // A delimiter that never appears yields 1 field everywhere -- consistent but useless.
    if (header < 2) continue;
    const consistent = counts.filter((c) => c === header).length;
    const ratio = consistent / counts.length;
    const candidate: SniffResult = {
      delimiter: delim,
      fieldCount: header,
      confident: ratio === 1,
    };
    // Prefer full consistency, then the richer split.
    if (
      best === null ||
      ratio > (best.confident ? 1 : 0) ||
      (candidate.confident && !best.confident) ||
      (candidate.confident === best.confident && candidate.fieldCount > best.fieldCount)
    ) {
      if (best === null || candidate.confident || !best.confident) best = candidate;
    }
  }

  return best ?? { delimiter: ',', fieldCount: 1, confident: false };
}
