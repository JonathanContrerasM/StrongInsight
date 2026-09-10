/**
 * Hand the browser a file. The one place that touches Blob and object URLs.
 *
 * Extracted from the metadata export in Settings once a second caller appeared.
 * The revoke matters: without it the blob is pinned for the life of the
 * document, and a few comparison exports is a few megabytes of retained text.
 */
export function downloadText(filename: string, mime: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * `You vs Alex` -> `you-vs-alex`. Safe on every filesystem this can reach.
 *
 * Accented letters are decomposed first, so `Jose` and `José` do not produce
 * different-looking slugs; whatever survives that and is not a-z0-9 becomes a
 * separator. Falls back to a fixed name rather than emitting a dotfile.
 */
export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? 'export' : slug;
}
