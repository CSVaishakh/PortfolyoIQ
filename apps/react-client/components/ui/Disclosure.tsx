import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "./cn";

interface DisclosureProps {
  summary: ReactNode;
  children: ReactNode;
  /** Open on first render — used to expand the trace automatically when a run blocks (AN-17). */
  defaultOpen?: boolean;
  /** Right-aligned adornment on the summary row — a count, a status chip. */
  action?: ReactNode;
  className?: string;
}

/**
 * Collapsible section.
 *
 * Native `<details>`: keyboard operable and announced correctly without any
 * ARIA of our own, and it still renders its content with JavaScript disabled.
 */
export function Disclosure({
  summary,
  children,
  defaultOpen,
  action,
  className,
}: DisclosureProps) {
  return (
    <details
      open={defaultOpen}
      className={cn("group border border-outline-variant rounded-xl bg-surface/40", className)}
    >
      <summary className="flex items-center gap-sm p-sm cursor-pointer list-none select-none rounded-xl text-label-xs uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors [&::-webkit-details-marker]:hidden">
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-90"
        />
        <span className="flex-1 min-w-0">{summary}</span>
        {action}
      </summary>
      <div className="px-sm pb-sm pt-0">{children}</div>
    </details>
  );
}
