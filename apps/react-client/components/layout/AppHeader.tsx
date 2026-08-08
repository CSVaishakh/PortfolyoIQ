"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, User } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { Button, ButtonLink } from "@/components/ui/Button";
import { cn } from "@/components/ui/cn";

const NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/interact", label: "Interact" },
] as const;

/**
 * The shared application header (GL-06, GL-08).
 *
 * Declared once and rendered by `AppShell`; every route used to carry its own
 * copy of this markup. `/auth` and `/train` deliberately do not use it.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { signedIn, user, signOut } = useSession();
  // The menu records the route it was opened on, so navigating closes it by
  // comparison — a link tap never leaves the panel covering the page it opened.
  const [menu, setMenu] = useState({ open: false, path: pathname });
  const menuOpen = menu.open && menu.path === pathname;
  const setMenuOpen = (open: boolean) => setMenu({ open, path: pathname });

  const navLink = (href: string, label: string, block = false) => {
    const current = pathname === href;
    return (
      <Link
        key={href}
        href={href}
        aria-current={current ? "page" : undefined}
        className={cn(
          "text-body-sm transition-colors rounded-lg",
          block && "py-sm",
          current
            ? "text-primary font-semibold"
            : "text-on-surface-variant hover:text-on-surface",
        )}
      >
        {label}
      </Link>
    );
  };

  const sessionControl = (block = false) =>
    signedIn ? (
      <div className={cn("flex items-center gap-sm", block && "w-full justify-between")}>
        <span className="flex items-center gap-sm min-w-0">
          <span
            aria-hidden="true"
            className="size-8 shrink-0 rounded-full bg-primary text-on-primary grid place-items-center"
          >
            <User className="size-4" />
          </span>
          <span className="text-body-sm text-on-surface-variant truncate max-w-40">
            {user?.username ?? user?.email ?? "Account"}
          </span>
        </span>
        <Button variant="ghost" size="sm" onClick={signOut}>
          Sign out
        </Button>
      </div>
    ) : (
      <ButtonLink href="/auth" size="sm" fullWidth={block}>
        Sign in
      </ButtonLink>
    );

  return (
    <header data-print="hide" className="fixed top-0 inset-x-0 z-50 bg-surface/80 backdrop-blur-xl border-b border-outline-variant">
      <div className="h-16 max-w-[1280px] mx-auto px-margin flex items-center justify-between gap-md">
        <Link href="/" className="text-title-xl text-primary tracking-tight font-semibold">
          PortfolioIQ
        </Link>

        <nav aria-label="Main" className="hidden md:flex items-center gap-xl">
          {NAV_LINKS.map((link) => navLink(link.href, link.label))}
        </nav>

        <div className="hidden md:flex items-center gap-md">{sessionControl()}</div>

        {/*
         * Below md the links move into a disclosure panel rather than being
         * squeezed until they are unusable — two links plus a session control
         * do not fit beside the wordmark at 320px.
         */}
        <button
          type="button"
          className="md:hidden size-11 -mr-2 grid place-items-center rounded-lg text-on-surface-variant hover:text-on-surface transition-colors"
          aria-expanded={menuOpen}
          aria-controls="mobile-nav"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen(!menuOpen)}
        >
          {menuOpen ? (
            <X aria-hidden="true" className="size-5" />
          ) : (
            <Menu aria-hidden="true" className="size-5" />
          )}
        </button>
      </div>

      {menuOpen && (
        <div
          id="mobile-nav"
          className="md:hidden border-t border-outline-variant bg-surface-container px-margin py-md"
          onKeyDown={(e) => {
            if (e.key === "Escape") setMenuOpen(false);
          }}
        >
          <nav aria-label="Main" className="flex flex-col gap-xs pb-sm">
            {NAV_LINKS.map((link) => navLink(link.href, link.label, true))}
          </nav>
          <div className="pt-sm border-t border-outline-variant">{sessionControl(true)}</div>
        </div>
      )}
    </header>
  );
}
