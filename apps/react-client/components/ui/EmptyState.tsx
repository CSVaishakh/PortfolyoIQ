import type { ReactNode } from "react";
import { cn } from "./cn";

interface EmptyStateProps {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}

/**
 * The placeholder a data panel shows before it has anything to show.
 *
 * Always states what would fill it and what the user should do — an empty box
 * with a grey glyph is not an empty state (CN-06).
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-sm text-center px-md py-xl",
        "rounded-xl border border-dashed border-outline-variant bg-surface/40",
        className,
      )}
    >
      <span aria-hidden="true" className="text-outline">
        {icon}
      </span>
      <p className="text-body-sm text-on-surface">{title}</p>
      {description && (
        <p className="text-label-xs font-normal text-on-surface-variant max-w-prose">{description}</p>
      )}
      {action}
    </div>
  );
}

/** Placeholder block for content that is still loading. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("block rounded-md bg-surface-container-high animate-pulse", className)}
    />
  );
}
