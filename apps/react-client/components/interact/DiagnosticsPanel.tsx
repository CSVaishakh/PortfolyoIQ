import { CircleDot, Circle } from "lucide-react";
import { Disclosure } from "@/components/ui/Disclosure";
import { StatLine } from "@/components/ui/Stat";
import { FEATURE_NAMES } from "@/lib/featureEngineering";
import { formatDate, formatPercent, formatRelativeDays } from "@/lib/format";
import type { AnalysisResult } from "@/hooks/useAnalysisRun";

interface DiagnosticsPanelProps {
  result: AnalysisResult;
}

/**
 * The audit surface: condition groups, portfolio statistics, market context and
 * the raw feature vector (AN-40 – AN-44).
 *
 * Grouped under disclosures because P1 acts on the verdict and P3 needs the
 * method — and the Stitch design leaves this zone as a two-line stub, so the
 * structure is inferred from the requirements it has to satisfy.
 */
export function DiagnosticsPanel({ result }: DiagnosticsPanelProps) {
  const { portfolioFeatures: pf, featureVector: fv, market } = result;

  return (
    <div className="flex flex-col gap-sm">
      <h3 className="text-label-xs uppercase tracking-wider text-on-surface-variant">
        Diagnostics
      </h3>

      {/* AN-40 */}
      <Disclosure
        summary="Condition groups"
        action={
          <span className="text-label-xs text-on-surface-variant">
            {result.conditions.filter((c) => c.triggered).length} of {result.conditions.length}{" "}
            triggered
          </span>
        }
      >
        <ul className="grid sm:grid-cols-2 gap-sm pt-sm">
          {result.conditions.map((condition) => (
            <li
              key={condition.name}
              className={`rounded-lg border p-sm flex flex-col gap-xs ${
                condition.triggered
                  ? "border-tertiary/40 bg-tertiary/5"
                  : "border-outline-variant bg-surface"
              }`}
            >
              <span className="flex items-center gap-xs">
                {condition.triggered ? (
                  <CircleDot aria-hidden="true" className="size-4 text-tertiary" />
                ) : (
                  <Circle aria-hidden="true" className="size-4 text-outline" />
                )}
                <span
                  className={`text-body-sm font-medium ${condition.triggered ? "text-tertiary" : "text-on-surface"}`}
                >
                  {condition.name}
                </span>
                {/* AX-06: the state is a word, not only a glyph and a colour. */}
                <span className="sr-only">{condition.triggered ? "triggered" : "not triggered"}</span>
              </span>
              <span className="text-label-xs font-normal text-on-surface-variant">{condition.description}</span>
            </li>
          ))}
        </ul>
      </Disclosure>

      {/* AN-41 */}
      <Disclosure summary="Portfolio statistics">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-sm pt-sm">
          <StatLine label="Holdings" value={String(pf.num_stocks)} />
          <StatLine label="Largest weight" value={formatPercent(pf.max_stock_weight)} />
          <StatLine label="Top-3 concentration" value={formatPercent(pf.top3_concentration)} />
          <StatLine label="Sector concentration" value={formatPercent(pf.sector_concentration)} />
          <StatLine label="Portfolio return" value={formatPercent(pf.portfolio_return, 2)} />
          <StatLine label="Portfolio volatility" value={formatPercent(pf.portfolio_volatility, 2)} />
          <StatLine label="Days since rebalance" value={String(fv[7])} />
          <StatLine
            label="Equal-weight drift"
            value={formatPercent(pf.total_weight_drift)}
            hint="Legacy measure"
          />
        </div>
        {/*
         * AN-42: this figure measures distance from an equal-weight portfolio and
         * is consumed only by the ML feature vector. Left unqualified beside a
         * target-relative decision it invites exactly the wrong reading.
         */}
        <p className="text-label-xs font-normal text-outline mt-sm">
          <strong className="text-on-surface-variant">Equal-weight drift</strong> is a legacy
          measure of distance from an equally-weighted portfolio, used only by the ML feature
          vector. It is not the target-relative active weight that drives the verdict — see the
          drift visualisation above for that.
        </p>
      </Disclosure>

      {/* AN-43 */}
      <Disclosure summary={`Market conditions — ${market.benchmark}`}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-sm pt-sm">
          <StatLine label="30d return" value={formatPercent(market.features.market_return_30d, 2)} />
          <StatLine
            label="30d volatility"
            value={formatPercent(market.features.market_volatility_30d, 2)}
          />
          <StatLine
            label="90d drawdown"
            value={formatPercent(market.features.market_drawdown_90d, 2)}
          />
          <StatLine
            label="Trend"
            value={market.features.market_trend === 1 ? "Bullish" : "Bearish"}
          />
        </div>
        <p className="text-label-xs font-normal text-outline mt-sm">
          Data to {formatDate(market.latestDate)} ({formatRelativeDays(market.ageDays)}),{" "}
          {market.rowCount} trading days. Source: {market.provenance}.
        </p>
      </Disclosure>

      {/* AN-44 */}
      <Disclosure summary="Raw feature vector">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-md gap-y-xs pt-sm">
          {FEATURE_NAMES.map((name: string, index: number) => (
            <div key={name} className="flex justify-between gap-sm border-b border-outline-variant/40 py-0.5">
              <dt className="font-mono text-label-xs text-on-surface-variant truncate">{name}</dt>
              <dd className="font-mono text-label-xs text-on-surface shrink-0">
                {formatFeature(fv[index])}
              </dd>
            </div>
          ))}
        </dl>
      </Disclosure>
    </div>
  );
}

/** DV-12: don't print a float at more precision than its inputs justify. */
function formatFeature(value: number): string {
  if (!Number.isFinite(value)) return "—";
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(4);
}
