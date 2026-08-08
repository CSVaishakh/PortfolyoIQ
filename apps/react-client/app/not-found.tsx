import type { Metadata } from "next";
import { FileQuestion } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { ButtonLink } from "@/components/ui/Button";

export const metadata: Metadata = {
  title: "Page not found — PortfolioIQ",
  description: "That page does not exist.",
};

/** GL-05: a recoverable failure state offering a route back to `/` and `/interact`. */
export default function NotFound() {
  return (
    <AppShell width="narrow">
      <div className="flex flex-col items-center text-center gap-md py-2xl">
        <FileQuestion aria-hidden="true" className="size-12 text-outline" />
        <h1 className="text-verdict-lg text-on-surface">Page not found</h1>
        <p className="text-body-base text-on-surface-variant max-w-prose">
          That address does not match any page here. Nothing was lost — the analysis runs entirely
          in your browser and holds no state between pages.
        </p>
        <div className="flex flex-col sm:flex-row gap-md mt-sm">
          <ButtonLink href="/interact">Start an analysis</ButtonLink>
          <ButtonLink href="/" variant="secondary">
            Back to the home page
          </ButtonLink>
        </div>
      </div>
    </AppShell>
  );
}
