import type { ReactNode } from "react";
import { cn } from "./cn";

export type BadgeTone = "primary" | "tertiary" | "success" | "error" | "neutral";
export type BadgeVariant = "solid" | "soft" | "outline";

const SOLID: Record<BadgeTone, string> = {
  primary: "bg-primary text-on-primary",
  tertiary: "bg-tertiary text-on-tertiary",
  success: "bg-success text-on-success",
  error: "bg-error text-on-error",
  neutral: "bg-surface-container-highest text-on-surface",
};

const SOFT: Record<BadgeTone, string> = {
  primary: "bg-primary/10 text-primary",
  tertiary: "bg-tertiary/10 text-tertiary",
  success: "bg-success/10 text-success",
  error: "bg-error/10 text-error",
  neutral: "bg-surface-container-high text-on-surface-variant",
};

const OUTLINE: Record<BadgeTone, string> = {
  primary: "border border-primary/40 text-primary",
  tertiary: "border border-tertiary/40 text-tertiary",
  success: "border border-success/40 text-success",
  error: "border border-error/40 text-error",
  neutral: "border border-outline-variant text-on-surface-variant",
};

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  variant?: BadgeVariant;
  /** Leading glyph. Always decorative — the label carries the meaning (AX-06). */
  icon?: ReactNode;
  uppercase?: boolean;
  className?: string;
}

/**
 * Status chip.
 *
 * Tone never carries meaning on its own: the label text is mandatory, so a
 * REBALANCE badge reads as "REBALANCE" and not merely as "the orange one"
 * (AX-06).
 */
export function Badge({
  children,
  tone = "neutral",
  variant = "soft",
  icon,
  uppercase,
  className,
}: BadgeProps) {
  const palette = variant === "solid" ? SOLID : variant === "outline" ? OUTLINE : SOFT;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-xs px-2 py-1 rounded-sm text-label-xs font-medium whitespace-nowrap",
        uppercase && "uppercase tracking-widest",
        palette[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
