import { ArrowRightLeft } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { formatAmount, formatDate, formatPercent, pluralise } from "@/lib/format";
import { ILLUSTRATION_MANDATE, type Illustration } from "@/lib/illustration";

interface IllustrativeOutputProps {
  illustration: Illustration;
}

/**
 * Sample output on the landing page.
 *
 * Every figure here is computed from a checked-in fixture at build time, not
 * written by hand — and the panel says so. Fabricated numbers presented as
 * product output are a disclosure defect (LP-05).
 */
export function IllustrativeOutput({ illustration }: IllustrativeOutputProps) {
  const { decision } = illustration;
  const breached = [...decision.trades]
    .filter((t) => Math.abs(t.activeWeight) > t.band)
    .sort((a, b) => Math.abs(b.activeWeight) - Math.abs(a.activeWeight))
    .slice(0, 4);
  // Largest orders by value, so the panel shows both sides of the trade rather
  // than whichever three happen to come first in the file.
  const orders = decision.trades
    .filter((t) => t.tradeShares !== 0)
    .sort((a, b) => Math.abs(b.tradeValueInr) - Math.abs(a.tradeValueInr))
    .slice(0, 4);
  const worst = breached[0];

  return (
    <section className="w-full px-margin py-2xl" aria-labelledby="illustration-heading">
      <div className="max-w-[1280px] mx-auto">
        <div className="bg-surface-container-lowest rounded-2xl border border-outline-variant/40 overflow-hidden shadow-2xl">
          {/* Window chrome, matching the Stitch treatment. */}
          <div className="flex items-center justify-between gap-md px-md py-sm bg-surface-container-low border-b border-outline-variant/60">
            <span aria-hidden="true" className="flex items-center gap-xs">
              <span className="size-2.5 rounded-full bg-outline-variant" />
              <span className="size-2.5 rounded-full bg-outline-variant" />
              <span className="size-2.5 rounded-full bg-outline-variant" />
            </span>
            <h2
              id="illustration-heading"
              className="text-label-xs uppercase tracking-widest text-on-surface-variant"
            >
              Illustrative output
            </h2>
          </div>

          <div className="grid md:grid-cols-5 gap-md p-md">
            {/* Left: the headline drift figure and the worst offenders. */}
            <div className="md:col-span-2 flex flex-col gap-md">
              <div className="rounded-xl bg-surface-container p-md flex flex-col gap-xs">
                <span className="text-label-xs uppercase tracking-wider text-on-surface-variant">
                  Largest active weight
                </span>
                <span className="flex items-baseline gap-sm">
                  <span className="text-verdict-lg text-tertiary">
                    {worst ? formatPercent(Math.abs(worst.activeWeight)) : "—"}
                  </span>
                  <span className="text-body-sm text-on-surface-variant">
                    {worst?.symbol ?? ""}
                  </span>
                </span>
                <span className="text-label-xs font-normal text-outline">
                  {breached.length} of {decision.trades.length} holdings outside their no-trade band
                </span>
              </div>

              <div className="rounded-xl bg-surface-container p-md flex flex-col gap-sm">
                <span className="text-label-xs uppercase tracking-wider text-on-surface-variant">
                  Allocation skew
                </span>
                <ul className="flex flex-col gap-sm">
                  {breached.map((trade) => {
                    const scale = Math.max(...breached.map((t) => t.currentWeight), 0.01);
                    return (
                      <li key={trade.symbol} className="flex flex-col gap-0.5">
                        <span className="flex justify-between text-label-xs">
                          <span className="font-mono text-on-surface">{trade.symbol}</span>
                          <span className="font-normal text-on-surface-variant">
                            {formatPercent(trade.currentWeight)} vs{" "}
                            {formatPercent(trade.targetWeight)}
                          </span>
                        </span>
                        <span
                          aria-hidden="true"
                          className="h-1.5 rounded-full bg-surface overflow-hidden"
                        >
                          <span
                            className="block h-full rounded-full bg-tertiary"
                            style={{ width: `${(trade.currentWeight / scale) * 100}%` }}
                          />
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Right: the resulting orders. */}
            <div className="md:col-span-3 rounded-xl bg-surface-container p-md flex flex-col gap-md">
              <div className="flex flex-wrap items-center justify-between gap-sm">
                <span className="text-body-sm font-semibold text-on-surface">
                  Recommended actions
                </span>
                <Badge
                  tone={decision.action === "REBALANCE" ? "tertiary" : "success"}
                  variant="solid"
                  uppercase
                  icon={<ArrowRightLeft aria-hidden="true" className="size-3.5" />}
                >
                  {decision.action}
                </Badge>
              </div>

              <ul className="flex flex-col gap-sm">
                {orders.map((trade) => (
                  <li key={trade.symbol} className="flex items-center gap-sm">
                    <Badge tone={trade.tradeShares > 0 ? "primary" : "tertiary"}>
                      {trade.tradeShares > 0 ? "Buy" : "Sell"}
                    </Badge>
                    <span className="font-mono text-body-sm text-on-surface flex-1 min-w-0 truncate">
                      {trade.symbol}
                    </span>
                    <span className="text-label-xs font-normal text-on-surface-variant">
                      {pluralise(Math.abs(trade.tradeShares), "share")}
                    </span>
                    <span className="font-mono text-body-sm text-on-surface w-24 text-right">
                      ₹{formatAmount(Math.abs(trade.tradeValueInr))}
                    </span>
                  </li>
                ))}
              </ul>

              <dl className="grid grid-cols-3 gap-sm pt-sm border-t border-outline-variant/60">
                <div>
                  <dt className="text-label-xs uppercase text-on-surface-variant">Net benefit</dt>
                  <dd className="text-body-sm font-semibold text-on-surface">
                    {decision.netBenefitBps.toFixed(1)} bps
                  </dd>
                </div>
                <div>
                  <dt className="text-label-xs uppercase text-on-surface-variant">Est. cost</dt>
                  <dd className="text-body-sm font-semibold text-on-surface">
                    {decision.costBps.toFixed(1)} bps
                  </dd>
                </div>
                <div>
                  <dt className="text-label-xs uppercase text-on-surface-variant">Tax drag</dt>
                  <dd className="text-body-sm font-semibold text-on-surface">
                    {decision.taxBps.toFixed(1)} bps
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>

        <p className="text-label-xs font-normal text-outline text-center mt-sm max-w-prose mx-auto">
          Rendered from the bundled <code className="font-mono">test-data/{illustration.fixture}</code>{" "}
          fixture ({ILLUSTRATION_MANDATE}) against NIFTY 50 data to{" "}
          {formatDate(illustration.marketDate)}. Synthetic holdings, real engine — not a
          recommendation for any actual portfolio.
        </p>
      </div>
    </section>
  );
}
