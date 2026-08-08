import { cn } from "./cn";

interface SpinnerProps {
  className?: string;
  /** Accessible name; omit when adjacent text already announces the busy state. */
  label?: string;
}

/**
 * Busy indicator.
 *
 * The spin is a CSS animation, so the global `prefers-reduced-motion` rule in
 * globals.css freezes it into a static ring rather than removing the indicator
 * altogether (DS-10).
 */
export function Spinner({ className, label }: SpinnerProps) {
  return (
    <span
      className={cn(
        "inline-block shrink-0 rounded-full border-2 border-current/25 border-t-current animate-spin",
        className ?? "size-4",
      )}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    />
  );
}
