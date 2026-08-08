import { DISCLOSURE } from "@/lib/copy";

/**
 * The shared footer (GL-08, GL-09).
 *
 * Carries the CN-01 disclosure verbatim. "System Admin" is deliberately plain
 * text and not a link: `/train` must not be reachable from any navigation or
 * footer (GL-03).
 */
export function AppFooter() {
  return (
    <footer className="w-full bg-surface-container-low border-t border-outline-variant py-xl mt-2xl">
      <div className="max-w-[1280px] mx-auto px-margin flex flex-col gap-md">
        <div className="flex flex-col sm:flex-row justify-between gap-md">
          <p className="text-body-sm text-on-surface-variant max-w-prose">
            <strong className="text-on-surface font-semibold">Legal disclaimer:</strong>{" "}
            {DISCLOSURE}
          </p>
          <span className="text-body-sm text-on-surface-variant shrink-0">System Admin</span>
        </div>
        <p className="text-label-xs text-outline text-center">
          © {new Date().getFullYear()} PortfolioIQ. Experimental build.
        </p>
      </div>
    </footer>
  );
}
