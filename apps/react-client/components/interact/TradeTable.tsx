"use client";

import { Download, Printer } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable, type Column } from "@/components/ui/DataTable";
import { formatAmount, formatCurrency, formatPercent, toIsoDate } from "@/lib/format";
import type { RebalanceTrade } from "@/lib/rebalanceEconomics";

interface TradeTableProps {
  trades: RebalanceTrade[];
}

const CSV_HEADER = [
  "Symbol",
  "Current Weight %",
  "Target Weight %",
  "Side",
  "Shares",
  "Estimated Value INR",
];

function toCsv(trades: RebalanceTrade[]): string {
  const rows = trades.map((t) => [
    t.symbol,
    (t.currentWeight * 100).toFixed(2),
    (t.targetWeight * 100).toFixed(2),
    t.tradeShares > 0 ? "BUY" : "SELL",
    String(Math.abs(t.tradeShares)),
    Math.abs(t.tradeValueInr).toFixed(2),
  ]);
  return [CSV_HEADER, ...rows]
    .map((row) => row.map((cell) => (cell.includes(",") ? `"${cell}"` : cell)).join(","))
    .join("\n");
}

/**
 * The executable trade list (AN-33).
 *
 * Only trades with a non-zero share count appear. Direction is stated in words
 * as well as colour (AN-34), the whole table is labelled as an estimate built
 * from user-entered prices (AN-38), and the totals row reconciles against the
 * cash figures in the rationale (AN-39).
 */
export function TradeTable({ trades }: TradeTableProps) {
  const executable = trades.filter((trade) => trade.tradeShares !== 0);
  if (executable.length === 0) return null;

  const buyValue = executable
    .filter((t) => t.tradeShares > 0)
    .reduce((sum, t) => sum + Math.abs(t.tradeValueInr), 0);
  const sellValue = executable
    .filter((t) => t.tradeShares < 0)
    .reduce((sum, t) => sum + Math.abs(t.tradeValueInr), 0);

  const columns: Array<Column<RebalanceTrade>> = [
    {
      key: "symbol",
      header: "Holding",
      render: (t) => <span className="font-mono text-on-surface">{t.symbol}</span>,
    },
    {
      key: "current",
      header: "Current %",
      align: "right",
      render: (t) => (
        <span className="text-on-surface-variant">{formatPercent(t.currentWeight)}</span>
      ),
    },
    {
      key: "target",
      header: "Target %",
      align: "right",
      render: (t) => formatPercent(t.targetWeight),
    },
    {
      key: "order",
      header: "Order",
      render: (t) => (
        <Badge tone={t.tradeShares > 0 ? "primary" : "tertiary"}>
          {t.tradeShares > 0 ? "Buy" : "Sell"} {Math.abs(t.tradeShares)}
        </Badge>
      ),
    },
    {
      key: "value",
      header: "Est. value (₹)",
      align: "right",
      render: (t) => (
        <span className="font-mono">{formatAmount(Math.abs(t.tradeValueInr))}</span>
      ),
    },
  ];

  function exportCsv() {
    const blob = new Blob([toCsv(executable)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `portfolioiq-trades-${toIsoDate(new Date())}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-sm">
      <div className="flex flex-wrap items-center justify-between gap-sm">
        <h4 className="text-label-xs uppercase tracking-wider text-on-surface-variant">
          Proposed trades
        </h4>
        <span data-print="hide" className="flex items-center gap-xs">
          <Button variant="ghost" size="sm" onClick={exportCsv}>
            <Download aria-hidden="true" className="size-4" />
            Export CSV
          </Button>
          {/* AN-37: the print stylesheet in globals.css reduces the result to a
              clean single column carrying the CN-01 disclosure. */}
          <Button variant="ghost" size="sm" onClick={() => window.print()}>
            <Printer aria-hidden="true" className="size-4" />
            Print
          </Button>
        </span>
      </div>

      <DataTable
        caption="Proposed trades, with current and target weights, order side and estimated value"
        columns={columns}
        rows={executable}
        rowKey={(trade) => trade.symbol}
      />

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-sm rounded-lg bg-surface p-sm">
        <div className="flex flex-col">
          <dt className="text-label-xs uppercase tracking-wider text-on-surface-variant">
            Total buys
          </dt>
          <dd className="text-body-sm font-semibold text-primary">{formatCurrency(buyValue)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-label-xs uppercase tracking-wider text-on-surface-variant">
            Total sells
          </dt>
          <dd className="text-body-sm font-semibold text-tertiary">{formatCurrency(sellValue)}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-label-xs uppercase tracking-wider text-on-surface-variant">
            Net cash effect
          </dt>
          <dd className="text-body-sm font-semibold text-on-surface">
            {formatCurrency(sellValue - buyValue)}
          </dd>
        </div>
      </dl>

      <p className="text-label-xs font-normal text-on-surface-variant">
        Estimated from the prices you entered, before brokerage confirmation. Share counts are
        whole units; values exclude charges applied at execution.
      </p>
    </div>
  );
}
