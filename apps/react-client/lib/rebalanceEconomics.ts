import type { PortfolioHolding } from "./portfolioParser";

export type AccountType = "taxable" | "tax-advantaged";

export interface RebalancePolicy {
  riskAversion: number;
  horizonDays: number;
  absoluteBand: number;
  relativeBand: number;
  tradingCostBps: number;
  shortTermTaxRate: number;
  longTermTaxRate: number;
  longTermExemptionInr: number;
  cashAvailableInr: number;
  minimumTradeInr: number;
  maxTurnover: number;
  accountType: AccountType;
}

export const DEFAULT_REBALANCE_POLICY: RebalancePolicy = {
  riskAversion: 3,
  horizonDays: 365,
  absoluteBand: 0.05,
  relativeBand: 0.25,
  tradingCostBps: 18,
  shortTermTaxRate: 0.20,
  longTermTaxRate: 0.125,
  longTermExemptionInr: 125000,
  cashAvailableInr: 0,
  minimumTradeInr: 1_000,
  maxTurnover: 0.25,
  accountType: "taxable",
};

export interface RebalanceTrade {
  symbol: string;
  currentWeight: number;
  targetWeight: number;
  activeWeight: number;
  band: number;
  /** Positive is a purchase; negative is a sale. */
  tradeValueInr: number;
  tradeShares: number;
}

export interface RebalanceDecision {
  action: "REBALANCE" | "HOLD";
  portfolioValueInr: number;
  trackingError: number;
  benefitBps: number;
  costBps: number;
  taxBps: number;
  netBenefitBps: number;
  turnover: number;
  openingCashInr: number;
  endingCashInr: number;
  trades: RebalanceTrade[];
  reasons: string[];
  caveats: string[];
}

function floorShares(valueInr: number, price: number): number {
  return Math.floor(Math.max(0, valueInr) / price);
}

/**
 * Deterministic target-relative decision support. It is intentionally an
 * estimate: supplied prices and cost/tax inputs are not broker confirmations.
 */
export function decideRebalance(
  holdings: PortfolioHolding[],
  targets: number[],
  annualMarketVolatility: number,
  policy: Partial<RebalancePolicy> = {},
): RebalanceDecision {
  const p = { ...DEFAULT_REBALANCE_POLICY, ...policy };
  if (!holdings.length || targets.length !== holdings.length || targets.some((target) => !Number.isFinite(target) || target < 0)) {
    throw new Error("A non-negative target weight is required for every holding");
  }
  if (!Number.isFinite(p.cashAvailableInr) || p.cashAvailableInr < 0 || !Number.isFinite(p.minimumTradeInr) || p.minimumTradeInr < 0) {
    throw new Error("Cash and minimum trade values must be non-negative");
  }
  if (!Number.isFinite(p.riskAversion) || p.riskAversion < 0 || !Number.isFinite(p.horizonDays) || p.horizonDays <= 0) {
    throw new Error("Risk preference and investment horizon must be valid positive values");
  }
  if (!Number.isFinite(p.maxTurnover) || p.maxTurnover < 0 || p.maxTurnover > 1) {
    throw new Error("Maximum turnover must be between 0% and 100%");
  }

  const values = holdings.map((holding) => holding.investment_volume * holding.current_price);
  const portfolioValueInr = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(portfolioValueInr) || portfolioValueInr <= 0) throw new Error("Portfolio value must be positive");

  const current = values.map((value) => value / portfolioValueInr);
  const active = current.map((weight, index) => weight - targets[index]!);
  const bands = active.map((_, index) => Math.min(p.absoluteBand, p.relativeBand * targets[index]!));
  const shouldTrade = active.some((value, index) => Math.abs(value) > bands[index]!);
  const desiredValue = active.map((value) => -value * portfolioValueInr);
  const maxSaleValue = portfolioValueInr * p.maxTurnover;

  // Sell first, capped by the mandate turnover limit. Whole-share rounding keeps
  // the cash ledger executable rather than presenting fractional-share trades.
  const tradeShares = holdings.map(() => 0);
  let soldValue = 0;
  // Whether the turnover limit — rather than the mandate — decided the sale
  // size. Measured on the sell side, because buy-side friction means realised
  // turnover can never quite reach the cap and would silence the disclosure.
  let turnoverCapped = false;
  for (let index = 0; index < holdings.length; index++) {
    if (!shouldTrade || desiredValue[index]! > -p.minimumTradeInr) continue;
    const wanted = -desiredValue[index]!;
    if (soldValue >= maxSaleValue) {
      turnoverCapped = true;
      continue;
    }
    if (wanted > maxSaleValue - soldValue) turnoverCapped = true;
    const holding = holdings[index]!;
    const requested = Math.min(wanted, maxSaleValue - soldValue);
    const shares = Math.min(holding.investment_volume, floorShares(requested, holding.current_price));
    const value = shares * holding.current_price;
    if (value >= p.minimumTradeInr) {
      tradeShares[index] = -shares;
      soldValue += value;
    }
  }

  const preliminaryTrades = holdings.map((holding, index) => ({
    symbol: holding.symbol,
    currentWeight: current[index]!,
    targetWeight: targets[index]!,
    activeWeight: active[index]!,
    band: bands[index]!,
    tradeValueInr: tradeShares[index]! * holding.current_price,
    tradeShares: tradeShares[index]!,
  }));
  let shortTermGains = 0;
  let longTermGains = 0;
  let missingTaxLots = false;
  for (let index = 0; index < holdings.length; index++) {
    const trade = preliminaryTrades[index]!;
    const holding = holdings[index]!;
    if (trade.tradeShares >= 0) continue;
    if (!holding.purchase_date) {
      missingTaxLots = true;
      continue;
    }
    const gain = -trade.tradeShares * (holding.current_price - holding.avg_buy_price);
    const heldDays = Math.floor((Date.now() - holding.purchase_date.getTime()) / 86_400_000);
    if (heldDays >= 365) longTermGains += gain;
    else shortTermGains += gain;
  }
  const taxInr = p.accountType === "taxable"
    ? Math.max(0, shortTermGains) * p.shortTermTaxRate + Math.max(0, longTermGains - p.longTermExemptionInr) * p.longTermTaxRate
    : 0;
  // Reserve estimated tax and sale costs before funding purchases. Buy-side
  // costs are included in each order's affordability calculation below.
  let availableCash = p.cashAvailableInr + soldValue - taxInr - soldValue * p.tradingCostBps / 10_000;
  for (let index = 0; index < holdings.length; index++) {
    if (!shouldTrade || desiredValue[index]! < p.minimumTradeInr) continue;
    const holding = holdings[index]!;
    const affordableValue = availableCash / (1 + p.tradingCostBps / 10_000);
    const shares = floorShares(Math.min(desiredValue[index]!, affordableValue), holding.current_price);
    const value = shares * holding.current_price;
    if (value >= p.minimumTradeInr) {
      tradeShares[index] = shares;
      availableCash -= value * (1 + p.tradingCostBps / 10_000);
    }
  }
  const trades = holdings.map((holding, index) => ({
    symbol: holding.symbol,
    currentWeight: current[index]!,
    targetWeight: targets[index]!,
    activeWeight: active[index]!,
    band: bands[index]!,
    tradeValueInr: tradeShares[index]! * holding.current_price,
    tradeShares: tradeShares[index]!,
  }));
  const boughtValue = trades.reduce((sum, trade) => sum + Math.max(0, trade.tradeValueInr), 0);
  const turnover = (soldValue + boughtValue) / (2 * portfolioValueInr);
  const frictionBps = (soldValue + boughtValue) / portfolioValueInr * p.tradingCostBps;
  const taxBps = taxInr / portfolioValueInr * 10_000;
  const costBps = frictionBps + taxBps;
  const trackingError = annualMarketVolatility * Math.sqrt(active.reduce((sum, value) => sum + value ** 2, 0));
  const benefitBps = 0.5 * p.riskAversion * trackingError ** 2 * (p.horizonDays / 365) * 10_000;
  const netBenefitBps = benefitBps - costBps;
  const hasExecutableTrades = trades.some((trade) => trade.tradeShares !== 0);
  const action = shouldTrade && hasExecutableTrades && netBenefitBps > 0 ? "REBALANCE" : "HOLD";
  const caveats = [
    "Costs and tax are estimates; confirm charges and tax treatment with your broker or tax adviser.",
    "Risk benefit uses a market-volatility proxy, not security-level covariance or return forecasts.",
    ...(missingTaxLots && p.accountType === "taxable" ? ["One or more proposed sales have no purchase date, so their tax estimate excludes those lots."] : []),
    ...(shouldTrade && !hasExecutableTrades ? ["Target bands were breached, but no proposed trade cleared the minimum-trade, cash, and turnover constraints."] : []),
    ...(turnoverCapped ? ["The trade list is capped at the turnover limit and may not fully restore target weights."] : []),
  ];
  return {
    action,
    portfolioValueInr,
    trackingError,
    benefitBps,
    costBps,
    taxBps,
    netBenefitBps,
    turnover,
    openingCashInr: p.cashAvailableInr,
    endingCashInr: availableCash,
    trades,
    reasons: !shouldTrade
      ? ["All positions remain inside their target-relative no-trade bands."]
      : !hasExecutableTrades
        ? ["Target bands were breached, but the stated execution constraints leave no executable trade."]
        : netBenefitBps > 0
          ? ["Target bands were breached and estimated risk reduction exceeds implementation cost."]
          : ["Target bands were breached, but estimated implementation cost exceeds benefit."],
    caveats,
  };
}
