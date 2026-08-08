import type { ReactNode } from "react";
import { AppHeader } from "./AppHeader";
import { AppFooter } from "./AppFooter";
import { cn } from "@/components/ui/cn";

interface AppShellProps {
  children: ReactNode;
  /** Content column width. `/` runs to 1280px, `/interact` to 1024px (RS-01). */
  width?: "wide" | "narrow" | "full";
  /** Target of the skip link — the first meaningful landmark on the page (AX-10). */
  skipTo?: { href: string; label: string };
  className?: string;
}

const WIDTHS = {
  wide: "max-w-[1280px] mx-auto px-margin",
  narrow: "max-w-[1024px] mx-auto px-margin",
  /** Sections manage their own containers — used by the landing page's full-bleed bands. */
  full: "",
} as const;

/**
 * Header + content + footer, shared by `/` and `/interact`.
 *
 * `/auth` and `/train` render without it by design (GL-06): the first is a
 * focused single task, the second is unlisted and must not carry public
 * navigation (GL-03).
 */
export function AppShell({ children, width = "wide", skipTo, className }: AppShellProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background text-on-background">
      <AppHeader />
      {/* pt-16 clears the fixed 64px header. */}
      <main className="w-full flex-1 pt-16">
        {skipTo && (
          <a
            href={skipTo.href}
            className="sr-only focus:not-sr-only focus:absolute focus:top-20 focus:left-4 focus:z-100 bg-primary text-on-primary px-md py-sm rounded-lg text-body-sm"
          >
            {skipTo.label}
          </a>
        )}
        <div className={cn(WIDTHS[width], className)}>{children}</div>
      </main>
      <AppFooter />
    </div>
  );
}

interface PageHeadingProps {
  title: string;
  description?: ReactNode;
  /** Right-aligned control, e.g. the admin "Restricted access" badge. */
  action?: ReactNode;
}

/** The `<h1>` block at the top of a route — exactly one per page (AX-09). */
export function PageHeading({ title, description, action }: PageHeadingProps) {
  return (
    <div className="mb-xl pt-xl relative flex flex-wrap items-start justify-between gap-md">
      {/* Ambient wash behind the heading, matching the Stitch treatment. */}
      <div
        aria-hidden="true"
        className="absolute -top-4 -left-12 size-64 bg-primary/5 rounded-full blur-3xl pointer-events-none"
      />
      <div className="relative z-10 min-w-0">
        <h1 className="text-verdict-lg text-on-background">{title}</h1>
        {description && (
          <p className="text-body-base text-on-surface-variant max-w-prose mt-sm">{description}</p>
        )}
      </div>
      {action && <div className="relative z-10 shrink-0">{action}</div>}
    </div>
  );
}
