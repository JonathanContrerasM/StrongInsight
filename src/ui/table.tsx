import type { ReactNode } from 'react';

/**
 * The sortable table cells shared by the Exercises and Sessions lists.
 *
 * Generic over the sort key so each list keeps its own union; the cells know
 * nothing about what they sort.
 */

export function Th<K extends string>({
  children,
  sortKey,
  sort,
  onSort,
  align = 'left',
}: {
  children: ReactNode;
  sortKey?: K;
  sort?: K;
  onSort?: (k: K) => void;
  align?: 'left' | 'right';
}) {
  const active = sortKey !== undefined && sort === sortKey;
  const alignCls = align === 'right' ? 'text-right' : 'text-left';
  return (
    <th
      scope="col"
      aria-sort={active ? 'descending' : undefined}
      // Background and rule live on the cell, not the row: `border-collapse`
      // paints collapsed borders with the table, so a `border-b` here tears off
      // as rows scroll under. And rows hover to the same `bg-sunken`, so the
      // header band has to be opaque in its own right.
      className={
        'bg-sunken px-3 py-2 font-medium shadow-[inset_0_-1px_0_var(--c-border)] ' + alignCls
      }
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={
            'hud-label inline-flex items-center gap-1 transition-colors hover:text-ink ' +
            (active ? 'text-accent-ink' : '')
          }
        >
          {children}
          <span aria-hidden className={active ? 'opacity-100' : 'opacity-0'}>
            &darr;
          </span>
        </button>
      ) : (
        <span className="hud-label">{children}</span>
      )}
    </th>
  );
}

export function Td({
  children,
  align = 'left',
  mono = false,
  muted = false,
}: {
  children: ReactNode;
  align?: 'left' | 'right';
  mono?: boolean;
  muted?: boolean;
}) {
  return (
    <td
      className={
        'px-3 py-2 ' +
        (align === 'right' ? 'text-right ' : '') +
        (mono ? 'num ' : '') +
        (muted ? 'text-dim' : 'text-ink')
      }
    >
      {children}
    </td>
  );
}
