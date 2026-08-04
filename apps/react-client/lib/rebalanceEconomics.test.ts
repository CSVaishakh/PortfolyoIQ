/**
 * Financial decision tests: target drift, no-trade bands, taxes, transaction
 * costs, cash reconciliation, stale data, and missing mandate inputs.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { decideRebalance, DEFAULT_REBALANCE_POLICY } from "./rebalanceEconomics";
import {
  assessMarketDataFreshness,
  getLatestMarketFeatures,
  MAX_MARKET_DATA_AGE_DAYS,
  MIN_MARKET_HISTORY_ROWS,
  parseNiftyCSV,
  type MarketRow,
} from "./marketData";
import { resolveTargetWeights, type PortfolioHolding } from "./portfolioParser";

const holdings: PortfolioHolding[] = [
  { symbol: "OVER", sector: "Financials", investment_volume: 10, avg_buy_price: 50, current_price: 100, target_weight: 25, purchase_date: new Date("2024-01-01") },
  { symbol: "UNDER", sector: "IT", investment_volume: 10, avg_buy_price: 100, current_price: 100, target_weight: 75, purchase_date: new Date("2024-01-01") },
];

const DAY_MS = 86_400_000;

/** Holding with a gain, whose holding period is set relative to today. */
function gainer(heldDays: number, overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    symbol: "GAIN",
    sector: "Financials",
    investment_volume: 100,
    avg_buy_price: 100,
    current_price: 200,
    target_weight: 10,
    purchase_date: new Date(Date.now() - heldDays * DAY_MS),
    ...overrides,
  };
}

function flat(overrides: Partial<PortfolioHolding> = {}): PortfolioHolding {
  return {
    symbol: "FLAT",
    sector: "IT",
    investment_volume: 100,
    avg_buy_price: 100,
    current_price: 100,
    target_weight: 90,
    purchase_date: new Date(Date.now() - 800 * DAY_MS),
    ...overrides,
  };
}

// ── Mandate inputs (plan: missing mandate inputs) ─────────────────────────────

test("a missing target mandate cannot fall back to equal weights", () => {
  const missing = resolveTargetWeights([{ ...holdings[0], target_weight: undefined }, holdings[1]]);
  assert.equal(missing.source, "missing");
  assert.deepEqual(missing.targets, []);
});

test("targets that do not add to a positive total are rejected, not rescaled", () => {
  const zeroed = resolveTargetWeights(holdings.map((h) => ({ ...h, target_weight: 0 })));
  assert.equal(zeroed.source, "invalid");
  assert.deepEqual(zeroed.targets, []);
});

test("declared percentage targets are normalized to fractions summing to one", () => {
  const resolved = resolveTargetWeights(holdings);
  assert.equal(resolved.source, "declared");
  assert.ok(Math.abs(resolved.targets.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(resolved.targets[0]! - 0.25) < 1e-12);
});

test("a decision cannot be produced without one target per holding", () => {
  assert.throws(() => decideRebalance(holdings, [1], 0.2), /target weight is required/i);
  assert.throws(() => decideRebalance(holdings, [0.5, -0.5], 0.2), /target weight is required/i);
  assert.throws(() => decideRebalance([], [], 0.2), /target weight is required/i);
});

test("an invalid horizon, risk preference or turnover limit is refused", () => {
  assert.throws(() => decideRebalance(holdings, [0.25, 0.75], 0.2, { horizonDays: 0 }), /horizon/i);
  assert.throws(() => decideRebalance(holdings, [0.25, 0.75], 0.2, { riskAversion: -1 }), /Risk preference/i);
  assert.throws(() => decideRebalance(holdings, [0.25, 0.75], 0.2, { maxTurnover: 1.5 }), /turnover/i);
  assert.throws(() => decideRebalance(holdings, [0.25, 0.75], 0.2, { cashAvailableInr: -1 }), /non-negative/i);
});

// ── Target-relative drift (plan: P1 acceptance criterion 1) ───────────────────

test("identical holdings with different targets can receive different recommendations", () => {
  // Both portfolios are 50/50 by market value. Only the mandate differs.
  const matchingTarget = decideRebalance(holdings, [0.5, 0.5], 0.2, { minimumTradeInr: 1 });
  const divergentTarget = decideRebalance(holdings, [0.25, 0.75], 0.2, { minimumTradeInr: 1 });

  assert.equal(matchingTarget.action, "HOLD", "a portfolio already on target must not trade");
  assert.equal(divergentTarget.action, "REBALANCE");
  assert.notEqual(matchingTarget.action, divergentTarget.action);
});

test("active weight is measured against the target, never against equal weights", () => {
  // A deliberate 90/10 concentration that is exactly on mandate is not drift.
  const concentrated: PortfolioHolding[] = [
    { ...holdings[0]!, investment_volume: 90, current_price: 100, avg_buy_price: 100 },
    { ...holdings[1]!, investment_volume: 10, current_price: 100, avg_buy_price: 100 },
  ];
  const decision = decideRebalance(concentrated, [0.9, 0.1], 0.2, { minimumTradeInr: 1 });

  assert.equal(decision.action, "HOLD");
  for (const trade of decision.trades) assert.ok(Math.abs(trade.activeWeight) < 1e-12);
});

test("target-relative orders are whole-share, cash reconciled, and turnover capped", () => {
  const decision = decideRebalance(holdings, [0.25, 0.75], 0.2, {
    cashAvailableInr: 0,
    minimumTradeInr: 1,
    maxTurnover: 0.25,
  });

  assert.equal(decision.action, "REBALANCE");
  assert.ok(decision.trades.some((trade) => trade.tradeShares < 0));
  assert.ok(decision.trades.some((trade) => trade.tradeShares > 0));
  assert.ok(decision.trades.every((trade) => Number.isInteger(trade.tradeShares)));
  assert.ok(decision.endingCashInr >= 0);
  assert.ok(decision.turnover <= 0.25);
});

test("every trade reconciles to the stated cash ledger", () => {
  const decision = decideRebalance(holdings, [0.25, 0.75], 0.2, {
    cashAvailableInr: 5_000,
    minimumTradeInr: 1,
  });

  const sold = decision.trades.reduce((sum, t) => sum + Math.max(0, -t.tradeValueInr), 0);
  const bought = decision.trades.reduce((sum, t) => sum + Math.max(0, t.tradeValueInr), 0);
  const costs = (sold + bought) * DEFAULT_REBALANCE_POLICY.tradingCostBps / 10_000;
  const taxInr = decision.taxBps / 10_000 * decision.portfolioValueInr;
  const expectedCash = decision.openingCashInr + sold - bought - costs - taxInr;

  assert.ok(
    Math.abs(decision.endingCashInr - expectedCash) < 1e-6,
    `cash ledger did not reconcile: ${decision.endingCashInr} vs ${expectedCash}`,
  );
  assert.ok(decision.endingCashInr >= -1e-9, "a trade list may never overdraw the account");
});

test("the turnover cap limits how much of the portfolio one round may trade", () => {
  const capped = decideRebalance(holdings, [0.0001, 0.9999], 0.2, { minimumTradeInr: 1, maxTurnover: 0.05 });
  assert.ok(capped.turnover <= 0.05 + 1e-9);
  assert.ok(capped.caveats.some((c) => /turnover limit/i.test(c)));
});

// ── No-trade bands ────────────────────────────────────────────────────────────

test("a no-trade band produces a hold even when a target differs slightly", () => {
  const decision = decideRebalance(holdings, [0.49, 0.51], 0.2, { minimumTradeInr: 1 });
  assert.equal(decision.action, "HOLD");
  assert.ok(decision.trades.every((trade) => trade.tradeShares === 0));
  assert.ok(decision.reasons.some((r) => /no-trade band/i.test(r)));
});

test("the band is the tighter of the absolute and relative limits", () => {
  // A 2% target with a 25% relative band gives 0.5%, well below the 5% absolute.
  const small: PortfolioHolding[] = [
    { ...holdings[0]!, investment_volume: 4, current_price: 100, avg_buy_price: 100 },
    { ...holdings[1]!, investment_volume: 96, current_price: 100, avg_buy_price: 100 },
  ];
  const decision = decideRebalance(small, [0.02, 0.98], 0.2, { minimumTradeInr: 1 });
  const smallBand = decision.trades[0]!.band;

  assert.ok(Math.abs(smallBand - 0.005) < 1e-12, `expected a 0.5% band, got ${smallBand}`);
  assert.ok(smallBand < DEFAULT_REBALANCE_POLICY.absoluteBand);
});

test("a minimum trade size suppresses orders too small to be worth placing", () => {
  const decision = decideRebalance(holdings, [0.35, 0.65], 0.2, { minimumTradeInr: 1_000_000 });
  assert.equal(decision.action, "HOLD");
  assert.ok(decision.trades.every((t) => t.tradeShares === 0));
  assert.ok(decision.caveats.some((c) => /minimum-trade/i.test(c)));
});

// ── Transaction costs ─────────────────────────────────────────────────────────

test("a punitive cost turns an otherwise worthwhile rebalance into a hold", () => {
  const options = { minimumTradeInr: 1, accountType: "tax-advantaged" as const };
  const cheap = decideRebalance(holdings, [0.25, 0.75], 0.6, { ...options, tradingCostBps: 1 });
  const expensive = decideRebalance(holdings, [0.25, 0.75], 0.6, { ...options, tradingCostBps: 4_000 });

  assert.equal(cheap.action, "REBALANCE");
  assert.equal(expensive.action, "HOLD");
  assert.ok(expensive.costBps > expensive.benefitBps);
  assert.ok(expensive.netBenefitBps < 0);
  assert.ok(expensive.reasons.some((r) => /cost exceeds benefit/i.test(r)));
});

test("cost rises with the trading-cost assumption while benefit does not", () => {
  const options = { minimumTradeInr: 1, accountType: "tax-advantaged" as const };
  const cheap = decideRebalance(holdings, [0.25, 0.75], 0.4, { ...options, tradingCostBps: 5 });
  const dear = decideRebalance(holdings, [0.25, 0.75], 0.4, { ...options, tradingCostBps: 50 });

  assert.ok(dear.costBps > cheap.costBps, "a tenfold cost assumption must show up in costBps");
  assert.ok(Math.abs(dear.benefitBps - cheap.benefitBps) < 1e-9, "risk benefit is independent of cost");
});

test("a larger risk aversion and a longer horizon both raise the estimated benefit", () => {
  const base = decideRebalance(holdings, [0.25, 0.75], 0.3, { minimumTradeInr: 1, riskAversion: 2, horizonDays: 365 });
  const riskier = decideRebalance(holdings, [0.25, 0.75], 0.3, { minimumTradeInr: 1, riskAversion: 6, horizonDays: 365 });
  const longer = decideRebalance(holdings, [0.25, 0.75], 0.3, { minimumTradeInr: 1, riskAversion: 2, horizonDays: 730 });

  assert.ok(riskier.benefitBps > base.benefitBps);
  assert.ok(longer.benefitBps > base.benefitBps);
});

// ── Taxes ─────────────────────────────────────────────────────────────────────

test("a tax-advantaged account pays no capital-gains tax on the same trades", () => {
  // A short holding period, so the gain is taxed rather than covered by the
  // long-term exemption — the point here is the account type, not the rate.
  const portfolio = [gainer(30), flat()];
  const taxable = decideRebalance(portfolio, [0.1, 0.9], 0.3, { minimumTradeInr: 1, accountType: "taxable" });
  const sheltered = decideRebalance(portfolio, [0.1, 0.9], 0.3, { minimumTradeInr: 1, accountType: "tax-advantaged" });

  assert.ok(taxable.trades.some((t) => t.tradeShares < 0), "the test needs a realised sale");
  assert.equal(sheltered.taxBps, 0);
  assert.ok(taxable.taxBps > 0, "a taxable realised gain must carry a tax estimate");
  assert.ok(taxable.costBps > sheltered.costBps);
});

test("a short holding period is taxed more heavily than a long one", () => {
  const shortTerm = decideRebalance([gainer(30), flat()], [0.1, 0.9], 0.3, {
    minimumTradeInr: 1, accountType: "taxable", longTermExemptionInr: 0,
  });
  const longTerm = decideRebalance([gainer(800), flat()], [0.1, 0.9], 0.3, {
    minimumTradeInr: 1, accountType: "taxable", longTermExemptionInr: 0,
  });

  assert.ok(shortTerm.taxBps > longTerm.taxBps, "the short-term rate must exceed the long-term rate");
  assert.ok(longTerm.taxBps > 0);
});

test("the long-term exemption reduces the estimated tax", () => {
  const withExemption = decideRebalance([gainer(800), flat()], [0.1, 0.9], 0.3, {
    minimumTradeInr: 1, accountType: "taxable", longTermExemptionInr: 125_000,
  });
  const withoutExemption = decideRebalance([gainer(800), flat()], [0.1, 0.9], 0.3, {
    minimumTradeInr: 1, accountType: "taxable", longTermExemptionInr: 0,
  });

  assert.ok(withExemption.taxBps < withoutExemption.taxBps);
  assert.ok(withExemption.taxBps >= 0);
});

test("a sale with no purchase date is flagged rather than silently untaxed", () => {
  const decision = decideRebalance(
    [gainer(400, { purchase_date: undefined }), flat()],
    [0.1, 0.9],
    0.3,
    { minimumTradeInr: 1, accountType: "taxable" },
  );

  assert.ok(decision.trades.some((t) => t.tradeShares < 0));
  assert.ok(
    decision.caveats.some((c) => /no purchase date/i.test(c)),
    "a missing tax lot must be disclosed, not assumed tax-free",
  );
});

test("a position at a loss creates no tax charge", () => {
  const loser = gainer(400, { symbol: "LOSS", avg_buy_price: 300, current_price: 200 });
  const decision = decideRebalance([loser, flat()], [0.1, 0.9], 0.3, {
    minimumTradeInr: 1, accountType: "taxable", longTermExemptionInr: 0,
  });

  assert.ok(decision.trades.some((t) => t.tradeShares < 0));
  assert.equal(decision.taxBps, 0);
});

test("every decision states its estimate caveats", () => {
  const decision = decideRebalance(holdings, [0.25, 0.75], 0.2, { minimumTradeInr: 1 });
  assert.ok(decision.caveats.some((c) => /estimates/i.test(c)));
  assert.ok(decision.caveats.some((c) => /volatility proxy/i.test(c)));
  assert.ok(decision.reasons.length > 0, "a decision must always carry a reason");
});

// ── Market-data freshness (plan: stale data must fail closed) ────────────────

function seriesEndingDaysAgo(daysAgo: number, count = 120): MarketRow[] {
  const end = Date.now() - daysAgo * DAY_MS;
  return Array.from({ length: count }, (_, i) => ({
    date: new Date(end - (count - 1 - i) * DAY_MS),
    close: 100 + i,
  }));
}

test("a current series is usable and reports its provenance", () => {
  const freshness = assessMarketDataFreshness(seriesEndingDaysAgo(1));
  assert.equal(freshness.usable, true);
  assert.equal(freshness.ageDays, 1);
  assert.ok(/source:/i.test(freshness.reason));
});

test("the freshness limit is inclusive at the boundary and closed one day past it", () => {
  assert.equal(assessMarketDataFreshness(seriesEndingDaysAgo(MAX_MARKET_DATA_AGE_DAYS)).usable, true);
  const stale = assessMarketDataFreshness(seriesEndingDaysAgo(MAX_MARKET_DATA_AGE_DAYS + 1));
  assert.equal(stale.usable, false);
  assert.ok(/stale/i.test(stale.reason));
});

test("the bundled dataset's own end date is checked, not assumed current", () => {
  // The dataset that shipped with the previous pipeline ended 27 Feb 2026; a
  // decision taken well after that must be blocked rather than silently served.
  const bundled = parseNiftyCSV(
    ["Date,Open,High,Low,Close,Adj Close,Volume",
      ...Array.from({ length: 120 }, (_, i) => `27-FEB-2026,1,1,1,${100 + i},${100 + i},0`)].join("\n"),
  );
  const laterThatYear = new Date("2026-08-04T00:00:00Z");
  assert.equal(assessMarketDataFreshness(bundled, laterThatYear).usable, false);
});

test("an empty or unreadable series fails closed", () => {
  const empty = assessMarketDataFreshness([]);
  assert.equal(empty.usable, false);
  assert.equal(empty.latestDate, null);
  assert.ok(/no market data/i.test(empty.reason));
});

test("too little history to compute the 90-day features fails closed", () => {
  const short = assessMarketDataFreshness(seriesEndingDaysAgo(1, MIN_MARKET_HISTORY_ROWS - 1));
  assert.equal(short.usable, false);
  assert.ok(/trading days/i.test(short.reason));
});

test("ISO-date market rows are accepted for the maintained NIFTY 50 source", () => {
  const rows = parseNiftyCSV([
    "Date,Open,High,Low,Close,Adj Close,Volume",
    ...Array.from({ length: 91 }, (_, index) => `2026-01-${String((index % 28) + 1).padStart(2, "0")},1,1,1,${100 + index},${100 + index},0`),
  ].join("\n"));
  // The parser sorts dates; its important contract here is strict ISO support
  // and enough valid rows for the standard 90-day feature calculation.
  assert.equal(rows.length, 91);
  assert.ok(getLatestMarketFeatures(rows));
});

test("unparseable rows are dropped rather than poisoning the series", () => {
  const rows = parseNiftyCSV([
    "Date,Open,High,Low,Close,Adj Close,Volume",
    "2026-01-05,1,1,1,100,100,0",
    "not-a-date,1,1,1,101,101,0",
    "2026-01-06,1,1,1,not-a-number,0,0",
    "2026-01-07,1,1,1,-5,0,0",
    "2026-01-08,1,1,1,102,102,0",
  ].join("\n"));

  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => Number.isFinite(r.close) && r.close > 0));
});
