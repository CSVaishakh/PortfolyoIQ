import type { ReactNode } from "react";
import { cn } from "./cn";

export type StatAccent = "primary" | "tertiary" | "success" | "error" | "none";

const ACCENTS: Record<StatAccent, string> = {
  primary: "border-l-2 border-l-primary",
  tertiary: "border-l-2 border-l-tertiary",
  success: "border-l-2 border-l-success",
  error: "border-l-2 border-l-error",
  none: "",
};

interface StatProps {
  label: ReactNode;
  value: ReactNode;
  /** Rendered smaller alongside the value — "bps", "%", a currency symbol. */
  unit?: ReactNode;
  /** Secondary line beneath: provenance, a delta, a qualification. */
  hint?: ReactNode;
  accent?: StatAccent;
  className?: string;
}

/** A single labelled figure. */
export function Stat({ label, value, unit, hint, accent = "none", className }: StatProps) {
  return (
    <div
      className={cn(
        "bg-surface rounded-lg p-sm flex flex-col gap-xs min-w-0",
        ACCENTS[accent],
        className,
      )}
    >
      <span className="text-label-xs uppercase tracking-wider text-on-surface-variant">{label}</span>
      <span className="text-title-xl text-on-surface break-words">
        {value}
        {unit && <span className="text-body-sm text-on-surface-variant ml-0.5">{unit}</span>}
      </span>
      {hint && <span className="text-label-xs text-on-surface-variant">{hint}</span>}
    </div>
  );
}

/**
 * Compact label/value pair for dense diagnostic grids, where a full `Stat` card
 * per figure would bury eight numbers in chrome.
 */
export function StatLine({ label, value, hint }: Omit<StatProps, "accent" | "className">) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-label-xs text-on-surface-variant">{label}</span>
      <span className="text-body-base font-semibold text-on-surface break-words">{value}</span>
      {hint && <span className="text-label-xs text-outline">{hint}</span>}
    </div>
  );
}

interface StatGridProps {
  children: ReactNode;
  /** Columns at `sm` and above; always 2 below it (RS-05). */
  columns?: 2 | 3 | 4;
  className?: string;
}

const COLUMNS: Record<2 | 3 | 4, string> = {
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-2 sm:grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
};

export function StatGrid({ children, columns = 4, className }: StatGridProps) {
  return <div className={cn("grid gap-sm", COLUMNS[columns], className)}>{children}</div>;
}
