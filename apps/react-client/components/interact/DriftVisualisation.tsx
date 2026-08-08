import { formatPercent, formatSignedPercent } from "@/lib/format";
import type { RebalanceTrade } from "@/lib/rebalanceEconomics";

interface DriftVisualisationProps {
  trades: RebalanceTrade[];
}

/**
 * Current versus target weight per holding, with the no-trade band drawn
 * (AN-31).
 *
 * This is the fastest available answer to "why this verdict": a bar past its
 * shaded band is a breach, a bar inside it is not, and the list is ordered by
 * how far off target each holding is. Plain CSS on a shared percentage scale —
 * the project has no charting library and this does not warrant introducing one.
 */
export function DriftVisualisation({ trades }: DriftVisualisationProps) {
  if (trades.length === 0) return null;

  // One scale for every row so bar lengths are comparable down the column.
  const scaleMax = Math.max(
    ...trades.map((t) => Math.max(t.currentWeight, t.targetWeight + t.band)),
    0.01,
  );
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / scaleMax) * 100))}%`;

  const ordered = [...trades].sort(
    (a, b) => Math.abs(b.activeWeight) - Math.abs(a.activeWeight),
  );

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center justify-between gap-x-md gap-y-xs">
        <h4 className="text-label-xs uppercase tracking-wider text-on-surface-variant">
          Drift visualisation
        </h4>
        <p className="text-label-xs text-outline flex items-center gap-sm">
          <span className="flex items-center gap-xs">
            <span aria-hidden="true" className="inline-block w-4 h-2 rounded-sm bg-surface-container-highest" />
            No-trade band
          </span>
          <span className="flex items-center gap-xs">
            <span aria-hidden="true" className="inline-block w-0.5 h-3 bg-on-surface align-middle" />
            Target
          </span>
        </p>
      </div>

      <ul className="flex flex-col gap-md rounded-xl bg-surface p-md">
        {ordered.map((trade) => {
          const breached = Math.abs(trade.activeWeight) > trade.band;
          const bandStart = Math.max(0, trade.targetWeight - trade.band);
          const bandWidth = Math.min(scaleMax, trade.targetWeight + trade.band) - bandStart;

          return (
            <li key={trade.symbol} className="flex flex-col gap-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-x-sm gap-y-0.5">
                <span className="font-mono text-body-sm text-on-surface">{trade.symbol}</span>
                <span className="text-label-xs text-on-surface-variant">
                  Current {formatPercent(trade.currentWeight)} · Target{" "}
                  {formatPercent(trade.targetWeight)} ·{" "}
                  <span className={breached ? "text-tertiary font-semibold" : "text-outline"}>
                    {formatSignedPercent(trade.activeWeight)}{" "}
                    {breached ? "outside band" : "inside band"}
                  </span>
                </span>
              </div>

              <div className="relative h-3 rounded-full bg-surface-container overflow-hidden">
                {/* The tolerance around target, before a holding counts as off-target. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 bg-surface-container-highest"
                  style={{ left: pct(bandStart), width: pct(bandWidth) }}
                />
                {/* Actual weight today. */}
                <span
                  aria-hidden="true"
                  className={`absolute inset-y-0 left-0 rounded-full ${breached ? "bg-tertiary" : "bg-primary"}`}
                  style={{ width: pct(trade.currentWeight) }}
                />
                {/* Target marker. */}
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 w-0.5 bg-on-surface"
                  style={{ left: pct(trade.targetWeight) }}
                />
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
