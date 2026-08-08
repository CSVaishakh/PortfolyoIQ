import { CheckCircle2, AlertTriangle, XCircle, Dot } from "lucide-react";
import type { TraceEntry, TraceStatus } from "@/hooks/useAnalysisRun";

const STATUS: Record<
  TraceStatus,
  { Icon: typeof CheckCircle2; className: string; text: string; label: string }
> = {
  ok: { Icon: CheckCircle2, className: "text-success", text: "text-on-surface", label: "Done" },
  warn: { Icon: AlertTriangle, className: "text-tertiary", text: "text-tertiary", label: "Warning" },
  error: { Icon: XCircle, className: "text-error", text: "text-error", label: "Error" },
  info: { Icon: Dot, className: "text-outline", text: "text-on-surface-variant", label: "Info" },
};

interface RunTraceProps {
  entries: TraceEntry[];
}

/**
 * The step-by-step audit trail of a run (AN-14).
 *
 * Status is carried by icon, colour and a visually-hidden word, so it survives
 * greyscale, colour-vision differences and screen readers alike (AN-15, AX-06).
 * The list is a polite live region so progress is announced as it happens
 * (AN-16, AX-07).
 */
export function RunTrace({ entries }: RunTraceProps) {
  return (
    <ol aria-live="polite" aria-label="Analysis progress" className="flex flex-col gap-xs">
      {entries.map((entry) => {
        const { Icon, className, text, label } = STATUS[entry.status];
        return (
          <li key={entry.id} className="flex items-start gap-sm text-body-sm">
            <Icon aria-hidden="true" className={`size-4 shrink-0 mt-0.5 ${className}`} />
            <span className="sr-only">{label}: </span>
            <span className={text}>{entry.message}</span>
          </li>
        );
      })}
    </ol>
  );
}
