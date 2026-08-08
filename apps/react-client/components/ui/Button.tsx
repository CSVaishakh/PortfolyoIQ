import type { ComponentPropsWithRef, ReactNode } from "react";
import Link from "next/link";
import { cn } from "./cn";
import { Spinner } from "./Spinner";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-on-primary hover:bg-primary-container hover:text-on-primary-container active:bg-primary-container",
  secondary:
    "bg-surface-container text-on-surface border border-outline-variant hover:bg-surface-container-high active:bg-surface-container-highest",
  ghost:
    "bg-transparent text-on-surface-variant hover:bg-surface-container hover:text-on-surface active:bg-surface-container-high",
  danger:
    "bg-error-container text-on-error-container hover:bg-error hover:text-on-error active:bg-error",
};

const SIZES: Record<ButtonSize, string> = {
  // Heights hold the 44px primary-action target of AX-11 at md and lg; sm is
  // reserved for secondary controls and still clears the 24px minimum.
  sm: "text-label-xs px-md py-xs gap-xs min-h-8",
  md: "text-body-sm px-lg py-sm gap-sm min-h-11",
  lg: "text-title-lg px-xl py-md gap-sm min-h-12",
};

const BASE =
  "inline-flex items-center justify-center rounded-lg font-medium transition-colors duration-200 " +
  "disabled:opacity-40 disabled:cursor-not-allowed disabled:pointer-events-none " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary";

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
  children: ReactNode;
}

export interface ButtonProps
  extends CommonProps,
    Omit<ComponentPropsWithRef<"button">, "className" | "children"> {
  /** Shows a spinner, disables the control, and announces the busy state. */
  busy?: boolean;
  /** Replaces the label while busy — e.g. "Signing in…" (AU-05). */
  busyLabel?: string;
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth,
  busy,
  busyLabel,
  className,
  children,
  disabled,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      // Non-re-entrant while in flight (AN-18, AU-05) — the guard is here rather
      // than at each call site so no button can forget it.
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className)}
      {...rest}
    >
      {busy && <Spinner className="size-4" />}
      {busy && busyLabel ? busyLabel : children}
    </button>
  );
}

export interface ButtonLinkProps extends CommonProps {
  href: string;
  download?: string | boolean;
}

/** A link styled as a button. Stays an `<a>` so it keeps link semantics (AX-02). */
export function ButtonLink({
  href,
  download,
  variant = "primary",
  size = "md",
  fullWidth,
  className,
  children,
}: ButtonLinkProps) {
  const classes = cn(BASE, VARIANTS[variant], SIZES[size], fullWidth && "w-full", className);

  // `download` and external targets need a plain anchor; Link would intercept
  // the navigation and the file would never be fetched.
  if (download !== undefined) {
    return (
      <a href={href} download={download} className={classes}>
        {children}
      </a>
    );
  }

  return (
    <Link href={href} className={classes}>
      {children}
    </Link>
  );
}
