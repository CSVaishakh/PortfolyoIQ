import type { ReactNode } from "react";
import { cn } from "./cn";

export interface Column<T> {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
}

interface DataTableProps<T> {
  /** Names the table for assistive technology. Required (AX-08). */
  caption: string;
  /** Hide the caption visually where an adjacent heading already states it. */
  captionHidden?: boolean;
  columns: Array<Column<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  /** Shown in place of the table when there are no rows. */
  empty?: ReactNode;
}

/**
 * Tabular data.
 *
 * Two presentations of one dataset: a real `<table>` from `sm` up, and one card
 * per row below it, because a five-column table at 320px is unreadable however
 * it scrolls (AN-35, AN-36). The table still scrolls inside its own container so
 * the page body never does (RS-03).
 */
export function DataTable<T>({
  caption,
  captionHidden = true,
  columns,
  rows,
  rowKey,
  empty,
}: DataTableProps<T>) {
  if (rows.length === 0 && empty) {
    return <>{empty}</>;
  }

  const [identity, ...details] = columns;

  return (
    <>
      {/* Table — sm and up */}
      <div className="hidden sm:block overflow-x-auto">
        <table className="w-full border-collapse text-body-sm">
          <caption className={cn("text-left", captionHidden ? "sr-only" : "text-label-xs text-on-surface-variant pb-sm")}>
            {caption}
          </caption>
          <thead>
            <tr className="border-b border-outline-variant">
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "py-sm px-xs first:pl-0 last:pr-0 text-label-xs uppercase tracking-wider text-on-surface-variant font-medium whitespace-nowrap",
                    column.align === "right" ? "text-right" : "text-left",
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={rowKey(row)}
                className="border-b border-outline-variant/50 last:border-0 hover:bg-surface-bright transition-colors"
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "py-sm px-xs first:pl-0 last:pr-0 text-on-surface",
                      column.align === "right" ? "text-right" : "text-left",
                    )}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards — below sm */}
      <ul className="sm:hidden flex flex-col gap-sm" aria-label={caption}>
        {rows.map((row) => (
          <li
            key={rowKey(row)}
            className="bg-surface rounded-lg p-sm flex flex-col gap-xs border border-outline-variant/40"
          >
            <div className="text-body-sm font-semibold text-on-surface">{identity.render(row)}</div>
            <dl className="grid grid-cols-2 gap-x-sm gap-y-xs">
              {details.map((column) => (
                <div key={column.key} className="flex flex-col min-w-0">
                  <dt className="text-label-xs uppercase tracking-wider text-on-surface-variant">
                    {column.header}
                  </dt>
                  <dd className="text-body-sm text-on-surface break-words">{column.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}
