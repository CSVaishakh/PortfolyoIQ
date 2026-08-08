"use client";

import { Play, CircleDashed } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Disclosure } from "@/components/ui/Disclosure";
import { RunTrace } from "./RunTrace";
import type { RunStatus, TraceEntry } from "@/hooks/useAnalysisRun";

interface AnalysisEngineCardProps {
  status: RunStatus;
  trace: TraceEntry[];
  /** Why `Run` is unavailable, or null when it is ready (AN-10). */
  blockedReason: string | null;
  onRun: () => void;
  onCancel: () => void;
  hasRun: boolean;
}

export function AnalysisEngineCard({
  status,
  trace,
  blockedReason,
  onRun,
  onCancel,
  hasRun,
}: AnalysisEngineCardProps) {
  const running = status === "running";
  // AN-17: P3 needs the trail, P1 does not — so it collapses once an outcome
  // exists, and stays open when the run ended badly.
  const traceOpen = running || status === "blocked" || status === "failed";

  return (
    <Card aria-labelledby="run-heading">
      <CardHeader
        id="run-heading"
        title="3. Analysis engine"
        level={2}
        action={
          running ? (
            <Button variant="secondary" size="sm" onClick={onCancel}>
              Cancel run
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={onRun}
              disabled={blockedReason !== null}
              aria-describedby={blockedReason ? "run-blocked-reason" : undefined}
            >
              <Play aria-hidden="true" className="size-4" />
              {hasRun ? "Re-run analysis" : "Run analysis"}
            </Button>
          )
        }
      />

      {blockedReason && !running && (
        <p id="run-blocked-reason" className="text-label-xs text-tertiary">
          {blockedReason}
        </p>
      )}

      {trace.length === 0 ? (
        <EmptyState
          icon={<CircleDashed className="size-6" />}
          title="Awaiting input data"
          description="Upload your filled template and complete the mandate, then run the engine."
        />
      ) : traceOpen ? (
        <div className="rounded-xl bg-surface p-md">
          <RunTrace entries={trace} />
          {running && (
            <p className="text-label-xs text-outline mt-sm">Running — this takes a few seconds.</p>
          )}
        </div>
      ) : (
        <Disclosure
          summary="Activity trace"
          action={<span className="text-label-xs text-outline">{trace.length} steps</span>}
        >
          <div className="pt-sm">
            <RunTrace entries={trace} />
          </div>
        </Disclosure>
      )}
    </Card>
  );
}
