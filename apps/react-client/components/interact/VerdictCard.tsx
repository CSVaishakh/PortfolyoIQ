import type { Ref } from "react";
import { ArrowRightLeft, Check, Info } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Stat, StatGrid } from "@/components/ui/Stat";
import { DriftVisualisation } from "./DriftVisualisation";
import { TradeTable } from "./TradeTable";
import { formatBps, formatCurrency, formatPercent } from "@/lib/format";
import type { AnalysisResult, SecondarySignal } from "@/hooks/useAnalysisRun";

/** AN-25: every provenance gets its own words, and none of them is "AI says". */
function describeSecondary(signal: SecondarySignal): {
  label: string;
  value: string | null;
  detail: string;
} {
  switch (signal.kind) {
    case "global":
      return signal.demo
        ? {
            label: "Secondary ML signal (synthetic demo model)",
            value: `${(signal.probability * 100).toFixed(0)}%`,
            detail:
              "Trained on a synthetic demonstration dataset for compatibility only. It carries no evidence about real portfolios.",
          }
        : {
            label: "Secondary ML signal (global model)",
            value: `${(signal.probability * 100).toFixed(0)}%`,
            detail:
              "Model confidence in rebalancing. Explanatory only — it does not affect the verdict above.",
          };
    case "fallback":
      return {
        label: "Secondary signal unavailable — rule-based reference only",
        value: null,
        detail:
          signal.reason ||
          "No compatible global model was available, so only the explanatory rule was evaluated.",
      };
    case "signed-out":
      return {
        label: "Sign in to see the secondary model signal",
        value: null,
        detail:
          "The deterministic verdict above is complete without it. An account only adds the explanatory model signal.",
      };
  }
}

interface VerdictCardProps {
  result: AnalysisResult;
  /** True when inputs changed after this result was produced (AN-46). */
  stale: boolean;
  headingRef?: Ref<HTMLHeadingElement>;
}

export function VerdictCard({ result, stale, headingRef }: VerdictCardProps) {
  const { decision, secondary } = result;
  const rebalance = decision.action === "REBALANCE";
  const description = describeSecondary(secondary);

  // AN-27: silent disagreement between the deterministic answer and the model
  // signal is a trust defect, so it is stated outright.
  const disagreement =
    (secondary.kind === "global" || secondary.kind === "fallback") &&
    (secondary.label === 1) !== rebalance;

  return (
    <div className="flex flex-col gap-lg">
      <header className="flex flex-wrap justify-between items-center gap-sm pb-sm border-b border-outline-variant">
        <h3
          ref={headingRef}
          tabIndex={-1}
          id="verdict-heading"
          className="text-title-lg text-on-surface flex flex-wrap items-center gap-sm"
        >
          Verdict
          <Badge
            tone={rebalance ? "tertiary" : "success"}
            variant="solid"
            uppercase
            icon={
              rebalance ? (
                <ArrowRightLeft aria-hidden="true" className="size-3.5" />
              ) : (
                <Check aria-hidden="true" className="size-3.5" />
              )
            }
          >
            {decision.action}
          </Badge>
        </h3>
        {stale && (
          <Badge tone="tertiary" variant="outline">
            Inputs changed — re-run to update
          </Badge>
        )}
      </header>

      {/* AN-24: the three figures that justify the action, adjacent to it. */}
      <StatGrid columns={3}>
        <Stat
          label="Net benefit"
          value={decision.netBenefitBps.toFixed(1)}
          unit="bps"
          accent={decision.netBenefitBps > 0 ? "success" : "tertiary"}
          hint="Estimated risk reduction less all costs"
        />
        <Stat
          label="Est. cost"
          value={decision.costBps.toFixed(1)}
          unit="bps"
          accent="primary"
          hint="Brokerage and tax combined"
        />
        <Stat
          label="Tax drag"
          value={decision.taxBps.toFixed(1)}
          unit="bps"
          accent="primary"
          hint="Included in implementation cost"
        />
      </StatGrid>
      <p className="text-label-xs font-normal text-outline -mt-sm">
        bps = basis points; 1 bp is 0.01% of portfolio value.
      </p>

      {/* AN-28: the engine's own rationale, verbatim. */}
      <div className="flex flex-col gap-xs rounded-xl bg-surface-container-low border border-outline-variant p-md">
        <h4 className="text-label-xs uppercase tracking-wider text-on-surface-variant">
          Decision rationale
        </h4>
        {decision.reasons.map((reason) => (
          <p key={reason} className="text-body-sm text-on-surface">
            {reason}
          </p>
        ))}

        {/* AN-30 */}
        <dl className="grid grid-cols-2 gap-sm mt-sm pt-sm border-t border-outline-variant">
          <div>
            <dt className="text-label-xs text-on-surface-variant">Tracking-error proxy</dt>
            <dd className="text-body-sm text-on-surface">
              {formatPercent(decision.trackingError, 2)}
            </dd>
          </div>
          <div>
            <dt className="text-label-xs text-on-surface-variant">Turnover</dt>
            <dd className="text-body-sm text-on-surface">{formatPercent(decision.turnover)}</dd>
          </div>
          {/*
           * Stated as a single figure rather than as "gross less cost = net":
           * each term is rounded to one decimal independently (DV-10), so the
           * subtraction visibly fails to add up when the margin is thin, which
           * undermines the number it is meant to explain. The three figures
           * above carry the breakdown.
           */}
          <div>
            <dt className="text-label-xs text-on-surface-variant">Gross benefit before costs</dt>
            <dd className="text-body-sm text-on-surface">{formatBps(decision.benefitBps)}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-label-xs text-on-surface-variant">Cash reconciliation</dt>
            <dd className="text-body-sm text-on-surface">
              {formatCurrency(decision.openingCashInr)} available →{" "}
              {formatCurrency(decision.endingCashInr)} after the proposed trades, estimated tax and
              costs.
            </dd>
          </div>
        </dl>
      </div>

      {/* AN-25/AN-26: subordinate to the verdict, labelled by provenance. */}
      <div className="flex flex-col gap-xs rounded-xl bg-surface-container-low border border-outline-variant p-md">
        <div className="flex flex-wrap justify-between items-center gap-sm">
          <h4 className="text-label-xs uppercase tracking-wider text-on-surface-variant">
            {description.label}
          </h4>
          {description.value && (
            <span className="text-body-sm font-semibold text-primary">
              {description.value} model confidence
            </span>
          )}
        </div>
        <p className="text-label-xs font-normal text-on-surface-variant">{description.detail}</p>
        {disagreement && (
          <Alert tone="warning" className="mt-xs">
            The secondary model leans the other way. The deterministic economics above govern the
            recommendation; the model signal is explanatory and does not override it.
          </Alert>
        )}
      </div>

      {/* AN-22: normalisation is a property of the result, not a log line. */}
      {result.targetNotes.map((note) => (
        <Alert key={note} tone="warning">
          {note}
        </Alert>
      ))}

      <DriftVisualisation trades={decision.trades} />

      <TradeTable trades={decision.trades} />

      {decision.trades.every((trade) => trade.tradeShares === 0) && (
        <Alert tone="info" className="items-center">
          <span className="flex items-center gap-xs">
            <Info aria-hidden="true" className="sr-only" />
            No trades are proposed, so there is nothing to execute.
          </span>
        </Alert>
      )}

      {/* AN-29: every caveat, none collapsed. */}
      <div className="flex flex-col gap-xs">
        <h4 className="text-label-xs uppercase tracking-wider text-on-surface-variant">
          Caveats
        </h4>
        <ul className="flex flex-col gap-xs rounded-lg border border-tertiary/30 bg-tertiary/5 p-sm list-disc pl-6">
          {decision.caveats.map((caveat) => (
            <li key={caveat} className="text-label-xs font-normal text-on-surface-variant">
              {caveat}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
