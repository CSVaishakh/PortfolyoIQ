import { OctagonAlert, Download } from "lucide-react";
import { ButtonLink } from "@/components/ui/Button";
import type { BlockingState, FailureState } from "@/hooks/useAnalysisRun";

interface BlockingPanelProps {
  state: BlockingState;
}

/**
 * The panel every blocking condition of AN-20 terminates in.
 *
 * One component covers all seven causes — missing columns, no valid holdings,
 * an incomplete or unusable target mandate, stale market data, too little
 * history, and uncomputable risk features — because they need the same three
 * things said: what happened, what it means, and what to do next. Previously
 * these appeared only as a line in the activity log.
 *
 * Rendering this panel and rendering a verdict are mutually exclusive; the run
 * state machine guarantees it (AN-21).
 */
export function BlockingPanel({ state }: BlockingPanelProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col items-center gap-md rounded-xl border border-error/40 bg-error-container/10 p-lg text-center"
    >
      <span
        aria-hidden="true"
        className="size-12 grid place-items-center rounded-full bg-error/15 text-error"
      >
        <OctagonAlert className="size-6" />
      </span>

      <div className="flex flex-col gap-xs">
        <h4 className="text-title-lg text-on-surface">{state.title}</h4>
        <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">{state.cause}</p>
        <p className="text-body-sm text-on-surface-variant max-w-prose mx-auto">
          {state.consequence}
        </p>
      </div>

      {state.details && state.details.length > 0 && (
        <ul className="w-full text-left flex flex-col gap-xs rounded-lg bg-surface p-sm">
          {state.details.map((detail) => (
            <li key={detail} className="text-label-xs font-normal font-mono text-on-surface-variant break-words">
              {detail}
            </li>
          ))}
        </ul>
      )}

      <p className="text-body-sm text-on-surface max-w-prose mx-auto">
        <strong className="font-semibold">Next: </strong>
        {state.action}
      </p>

      <ButtonLink
        href="/templates/portfolio-template.xlsx"
        download="portfolio-template.xlsx"
        variant="secondary"
        size="sm"
      >
        <Download aria-hidden="true" className="size-4" />
        Download the template
      </ButtonLink>
    </div>
  );
}

/**
 * An unexpected exception, rendered legibly with a recovery action rather than
 * as a bare `Error.message` (GL-16).
 */
export function FailurePanel({ state }: { state: FailureState }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex flex-col gap-sm rounded-xl border border-error/40 bg-error-container/10 p-lg"
    >
      <h4 className="text-title-lg text-on-surface flex items-center gap-sm">
        <OctagonAlert aria-hidden="true" className="size-5 text-error" />
        {state.title}
      </h4>
      <p className="text-body-sm text-on-surface-variant">{state.message}</p>
      <p className="text-body-sm text-on-surface">
        <strong className="font-semibold">Next: </strong>
        {state.action}
      </p>
    </div>
  );
}
