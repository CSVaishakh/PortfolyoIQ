"use client";

import { OctagonAlert } from "lucide-react";
import { Button, ButtonLink } from "@/components/ui/Button";

/**
 * GL-05 / GL-16: an unhandled render error becomes a legible page with a
 * recovery action, not a blank screen.
 *
 * Error boundaries must be client components, and this one cannot use `AppShell`
 * — the shell is what may have failed.
 */
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-background text-on-background flex items-center justify-center px-margin">
      <div className="max-w-prose flex flex-col items-center text-center gap-md">
        <OctagonAlert aria-hidden="true" className="size-12 text-error" />
        <h1 className="text-verdict-lg text-on-surface">Something failed to render</h1>
        <p className="text-body-base text-on-surface-variant">
          The page stopped before it finished loading. Your inputs were never sent anywhere, so
          retrying is safe.
        </p>
        <div className="flex flex-col sm:flex-row gap-md mt-sm">
          <Button onClick={reset}>Try again</Button>
          <ButtonLink href="/interact" variant="secondary">
            Go to the analysis page
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
