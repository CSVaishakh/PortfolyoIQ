"use client";

import { useMemo, useRef, useState } from "react";
import { BarChart3 } from "lucide-react";
import { AppShell, PageHeading } from "@/components/layout/AppShell";
import { Card, CardHeader } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";
import { EmptyState } from "@/components/ui/EmptyState";
import { HoldingsIntakeCard, type FilePreview } from "@/components/interact/HoldingsIntakeCard";
import { MandateCard } from "@/components/interact/MandateCard";
import { AnalysisEngineCard } from "@/components/interact/AnalysisEngineCard";
import { BlockingPanel, FailurePanel } from "@/components/interact/BlockingPanel";
import { VerdictCard } from "@/components/interact/VerdictCard";
import { DiagnosticsPanel } from "@/components/interact/DiagnosticsPanel";
import { useAnalysisRun } from "@/hooks/useAnalysisRun";
import { useSession } from "@/hooks/useSession";
import { MANDATE_DEFAULTS, runBlockedReason, validateMandate, type MandateInput } from "@/lib/mandate";
import { parsePortfolioFile } from "@/lib/portfolioParser";
import { DISCLOSURE, PRIVACY_CLAIM } from "@/lib/copy";
import { formatDateTime } from "@/lib/format";

/**
 * The product surface: intake → mandate → run → result.
 *
 * This component owns only the inputs and the composition. Pipeline execution
 * and the run state machine live in `useAnalysisRun`; validation lives in
 * `lib/mandate`. The previous single 773-line file mixed all three.
 */
export default function InteractClient() {
  const { token } = useSession();

  const [file, setFile] = useState<File | null>(null);
  const [rejection, setRejection] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [mandate, setMandate] = useState<MandateInput>(MANDATE_DEFAULTS);

  const verdictHeadingRef = useRef<HTMLHeadingElement>(null);

  const validation = useMemo(() => validateMandate(mandate), [mandate]);

  /**
   * AN-46: the identity of the inputs behind a result. When it changes, the
   * displayed result is badged stale rather than silently describing a mandate
   * the user can no longer see.
   */
  const signature = useMemo(
    () => [file?.name, file?.size, file?.lastModified, JSON.stringify(mandate)].join("|"),
    [file, mandate],
  );

  const run = useAnalysisRun(signature, file !== null);

  async function handleFileSelected(selected: File) {
    setFile(selected);
    setRejection(null);
    setPreview(null);
    // AN-05: a new file invalidates any previous outcome outright.
    run.reset();

    // AN-06: show what was read before the pipeline runs, so a wrong file is
    // caught without executing anything.
    const { holdings } = await parsePortfolioFile(selected);
    const complete = holdings.length > 0 && holdings.every((h) => h.target_weight !== undefined);
    setPreview({
      holdings: holdings.length,
      totalValueInr: holdings.reduce(
        (sum, h) => sum + h.investment_volume * h.current_price,
        0,
      ),
      declaredTargetTotal: complete
        ? holdings.reduce((sum, h) => sum + (h.target_weight ?? 0), 0)
        : null,
    });
  }

  function handleRun() {
    if (!file || !validation.values) return;
    void run
      .start({ file, mandate: validation.values, token, signature })
      // DS-12: take keyboard and screen-reader users to the answer.
      .then(() => verdictHeadingRef.current?.focus());
  }

  const blockedReason = runBlockedReason(file !== null, validation);
  const hasOutcome = run.status === "complete" || run.status === "blocked" || run.status === "failed";

  return (
    <AppShell
      width="narrow"
      skipTo={{ href: "#analysis-form", label: "Skip to the analysis form" }}
    >
      <PageHeading
        title="Portfolio analysis"
        description="Upload your current holdings and declare your mandate to generate a deterministic rebalance verdict. No account is required."
      />

      <Alert tone="error" className="mb-lg">
        <strong className="text-on-surface font-semibold">Educational prototype: </strong>
        {DISCLOSURE}
      </Alert>

      <div id="analysis-form" className="grid grid-cols-1 lg:grid-cols-12 gap-xl">
        {/* Intake and mandate. Below lg these stack above the engine (RS-04). */}
        <div data-print="hide" className="lg:col-span-5 flex flex-col gap-lg">
          <HoldingsIntakeCard
            file={file}
            onFileSelected={handleFileSelected}
            rejection={rejection}
            onRejected={(reason) => {
              setRejection(reason);
              setPreview(null);
            }}
            preview={preview}
            disabled={run.status === "running"}
          />

          <MandateCard
            value={mandate}
            errors={validation.errors}
            onChange={(patch) => setMandate((prev) => ({ ...prev, ...patch }))}
            disabled={run.status === "running"}
          />

          <p className="text-label-xs font-normal text-on-surface-variant">{PRIVACY_CLAIM}</p>
        </div>

        {/* Run control and result. */}
        <div className="lg:col-span-7 flex flex-col gap-lg">
          <AnalysisEngineCard
            status={run.status}
            trace={run.trace}
            blockedReason={blockedReason}
            onRun={handleRun}
            onCancel={run.cancel}
            hasRun={hasOutcome}
          />

          <Card aria-labelledby="result-zone-heading" aria-live="polite">
            <CardHeader
              id="result-zone-heading"
              title="4. Output verdict"
              level={2}
              action={
                run.result && (
                  <span className="font-mono text-label-xs text-outline">
                    {formatDateTime(run.result.completedAt)}
                  </span>
                )
              }
            />

            {run.status === "blocked" && run.blocking && <BlockingPanel state={run.blocking} />}
            {run.status === "failed" && run.failure && <FailurePanel state={run.failure} />}

            {run.status === "complete" && run.result && (
              <>
                <VerdictCard
                  result={run.result}
                  stale={run.stale}
                  headingRef={verdictHeadingRef}
                />
                <DiagnosticsPanel result={run.result} />
              </>
            )}

            {!hasOutcome && (
              <EmptyState
                icon={<BarChart3 className="size-7" />}
                title="Run the engine to generate a verdict"
                description="The verdict, proposed trades, costs and caveats appear here once an analysis completes."
              />
            )}
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
