import type { PortfolioHolding } from "./portfolioParser";
import type { MarketRow, MarketFeatures } from "./marketData";
import { computeMarketFeatures } from "./marketData";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortfolioFeatures {
  num_stocks: number;
  max_stock_weight: number;
  top3_concentration: number;
  total_weight_drift: number;
  portfolio_return: number;
  portfolio_volatility: number;
  sector_concentration: number;
}

// Index contract for the 12-element feature vector:
// [0]  num_stocks
// [1]  max_stock_weight
// [2]  top3_concentration
// [3]  total_weight_drift
// [4]  portfolio_return
// [5]  portfolio_volatility
// [6]  sector_concentration
// [7]  days_since_last_rebalance
// [8]  market_return_30d
// [9]  market_volatility_30d
// [10] market_drawdown_90d
// [11] market_trend
export type FeatureVector = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
];

export const FEATURE_NAMES = [
  "num_stocks",
  "max_stock_weight",
  "top3_concentration",
  "total_weight_drift",
  "portfolio_return",
  "portfolio_volatility",
  "sector_concentration",
  "days_since_last_rebalance",
  "market_return_30d",
  "market_volatility_30d",
  "market_drawdown_90d",
  "market_trend",
] as const;

export interface LabeledDataset {
  X: number[][];
  y: number[];
  nRebalance: number;
  nHold: number;
}

// A volatility threshold used in the time_risk condition group.
// Represents the boundary between "low" and "elevated" portfolio volatility.
const VOLATILITY_THRESHOLD = 0.005;

// ── Feature standardization ───────────────────────────────────────────────────
//
// WHY A FIXED SCALER
// ──────────────────
// Days-since-rebalance lives in [0, 250], weight ratios in [0, 1] and returns/vol
// near 0. Unscaled features mean gradient magnitude is proportional to raw feature
// magnitude, so `days` (and to a lesser extent `total_weight_drift`) swamps every
// other signal and the model collapses onto those two. We standardize every
// feature with a fixed, deterministic transform derived from the seed dataset so
// that:
//   1. no feature dominates by raw magnitude,
//   2. the browser (TF.js) and the model-service (sklearn) provably operate in the
//      same space — their weights are directly comparable under FedAvg.
// The constants below are mirrored verbatim in apps/model-service/app/main.py.
export const SCALER_MEAN = [
  8.952400,   // num_stocks
  0.359684,   // max_stock_weight
  0.564518,   // top3_concentration
  0.432519,   // total_weight_drift
  0.059413,   // portfolio_return
  0.020793,   // portfolio_volatility
  0.524913,   // sector_concentration
  125.8444,   // days_since_last_rebalance
  -0.000101,  // market_return_30d
  0.027868,   // market_volatility_30d
  -0.182608,  // market_drawdown_90d
  0.498600,   // market_trend
];

export const SCALER_STD = [
  3.763425,   // num_stocks
  0.166928,   // max_stock_weight
  0.250468,   // top3_concentration
  0.237506,   // total_weight_drift
  0.208244,   // portfolio_return
  0.011298,   // portfolio_volatility
  0.226788,   // sector_concentration
  73.296687,  // days_since_last_rebalance
  0.069579,   // market_return_30d
  0.015645,   // market_volatility_30d
  0.138651,   // market_drawdown_90d
  0.500048,   // market_trend
];

/**
 * Standardize a single feature vector with the fixed scaler above.
 * Features with (near-)zero standard deviation are mapped to 0 so the transform
 * is always finite and the model never sees an infinite input.
 */
export function standardizeFeatureVector(fv: FeatureVector | number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < fv.length; i++) {
    const std = SCALER_STD[i];
    if (std < 1e-9) {
      out.push(0);
    } else {
      out.push((fv[i] - SCALER_MEAN[i]) / std);
    }
  }
  return out;
}

export function standardizeFeatureMatrix(X: number[][]): number[][] {
  return X.map((row) => standardizeFeatureVector(row));
}

// ── Portfolio feature computation ─────────────────────────────────────────────

export function computePortfolioFeatures(holdings: PortfolioHolding[]): PortfolioFeatures {
  const n = holdings.length;

  // Current market value and portfolio weights
  const currentValues = holdings.map((h) => h.investment_volume * h.current_price);
  const totalValue = currentValues.reduce((a, b) => a + b, 0);
  const weights = currentValues.map((v) => v / totalValue);

  // Individual stock returns: Ri = (currentPrice − avgBuyPrice) / avgBuyPrice
  const stockReturns = holdings.map(
    (h) => (h.current_price - h.avg_buy_price) / h.avg_buy_price
  );

  // Portfolio return: Rp = Σ Wi * Ri
  const portfolio_return = weights.reduce((s, w, i) => s + w * stockReturns[i], 0);

  // Max stock weight
  const max_stock_weight = Math.max(...weights);

  // Top-3 concentration: sum of the three largest weights
  const sortedWeights = [...weights].sort((a, b) => b - a);
  const top3_concentration = sortedWeights.slice(0, Math.min(3, n)).reduce((a, b) => a + b, 0);

  // Total weight drift: Σ |Wi − 1/N|
  const idealWeight = 1 / n;
  const total_weight_drift = weights.reduce((s, w) => s + Math.abs(w - idealWeight), 0);

  // Portfolio volatility: Σ Wi * (Ri − Rp)²
  const portfolio_volatility = weights.reduce(
    (s, w, i) => s + w * (stockReturns[i] - portfolio_return) ** 2,
    0
  );

  // Sector concentration: max of per-sector weight sum
  const sectorWeights: Record<string, number> = {};
  for (let i = 0; i < n; i++) {
    const sec = holdings[i].sector.trim().toUpperCase();
    sectorWeights[sec] = (sectorWeights[sec] ?? 0) + weights[i];
  }
  const sector_concentration = Math.max(...Object.values(sectorWeights));

  return {
    num_stocks: n,
    max_stock_weight,
    top3_concentration,
    total_weight_drift,
    portfolio_return,
    portfolio_volatility,
    sector_concentration,
  };
}

// ── Feature vector assembly ───────────────────────────────────────────────────

export function buildFeatureVector(
  pf: PortfolioFeatures,
  mf: MarketFeatures,
  days_since_last_rebalance: number
): FeatureVector {
  return [
    pf.num_stocks,
    pf.max_stock_weight,
    pf.top3_concentration,
    pf.total_weight_drift,
    pf.portfolio_return,
    pf.portfolio_volatility,
    pf.sector_concentration,
    days_since_last_rebalance,
    mf.market_return_30d,
    mf.market_volatility_30d,
    mf.market_drawdown_90d,
    mf.market_trend,
  ];
}

// ── Labeling ──────────────────────────────────────────────────────────────────
//
// WHY A SOFT (NON-VETO) TIME SIGNAL
// ─────────────────────────────────
// The previous `getTScore` returned −5…+5 while the risk `delta` was clamped to
// ±2.5. Because |tScore| could exceed max|delta|, a portfolio rebalanced ≤14d ago
// could NEVER be labelled Rebalance and one >90d old could NEVER be labelled Hold —
// a hard veto where days alone silently decided ~70% of labels. Consequently the
// model degenerated into reading `days_since_last_rebalance` back to itself.
//
// The time signal below is bounded to the SAME ±2.5 range as `delta`, so no single
// feature can override the aggregate of the others. Only the *combination* of risk
// factors decides the label, and a genuinely divergent portfolio can still demand a
// rebalance days after the last one, while a low-risk one can meaningfully be left
// alone for months.

/** Bounded soft time signal in (−2.5, +2.5): days≈0 → −2.5, days→∞ → +2.5. */
function softTimeScore(days: number): number {
  // Logistic centred at 60 days, steepness such that ~|Δ|≤2.5 over [0, 250].
  const z = (days - 60) / 40;
  return 2.5 * (2 / (1 + Math.exp(-z)) - 1);
}

export function labelFeatureVector(fv: FeatureVector): 0 | 1 {
  return computeLabelScore(fv).label;
}

/**
 * Raw (soft) score components for a feature vector.
 * Exposed so the UI can show a real probability even when the global model is
 * unavailable (heuristic fallback) — the same scoring used to synthesise labels.
 */
export function computeLabelScore(fv: FeatureVector): {
  score: number;
  prob: number;
  tScore: number;
  delta: number;
  label: 0 | 1;
} {
  const [
    ,
    max_stock_weight,
    top3_concentration,
    total_weight_drift,
    ,
    portfolio_volatility,
    sector_concentration,
    days_since_last_rebalance,
    ,
    market_volatility_30d,
    market_drawdown_90d,
    market_trend,
  ] = fv;

  const tScore = softTimeScore(days_since_last_rebalance);

  let delta = 0.0;

  if      (total_weight_drift > 0.80)        delta += 1.2;
  else if (total_weight_drift > 0.50)        delta += 0.6;
  else if (total_weight_drift < 0.20)        delta -= 0.8;

  if      (max_stock_weight > 0.55)          delta += 0.8;
  else if (max_stock_weight > 0.40)          delta += 0.3;
  else if (max_stock_weight < 0.15)          delta -= 0.5;

  if      (sector_concentration > 0.75)      delta += 0.8;
  else if (sector_concentration > 0.55)      delta += 0.3;
  else if (sector_concentration < 0.25)      delta -= 0.4;

  if      (market_drawdown_90d < -0.20)      delta += 0.6;
  else if (market_drawdown_90d < -0.10)      delta += 0.3;
  else if (market_drawdown_90d > 0.05)       delta -= 0.4;

  if (market_trend === 0)                    delta -= 0.4;

  if      (market_volatility_30d > 0.025)    delta += 0.5;
  else if (market_volatility_30d < 0.008)    delta -= 0.3;

  if      (portfolio_volatility > 0.025)     delta += 0.4;
  else if (portfolio_volatility < 0.005)     delta -= 0.2;

  if (top3_concentration > 0.85)             delta += 0.4;

  // clamp BOTH components to the same symmetric range so neither can veto
  const clampedT  = Math.max(-2.5, Math.min(2.5, tScore));
  const clampedD  = Math.max(-2.5, Math.min(2.5, delta));
  const score     = clampedT + clampedD;
  const prob      = 1 / (1 + Math.exp(-score));

  console.log(
    `[label] days=${days_since_last_rebalance} t_score=${clampedT.toFixed(4)} ` +
    `delta=${clampedD.toFixed(4)} score=${score.toFixed(4)} prob=${prob.toFixed(4)}`
  );

  return {
    score,
    prob,
    tScore: clampedT,
    delta: clampedD,
    label: prob >= 0.5 ? 1 : 0,
  };
}

// ── Training dataset generation ──────────────────────────────────────────────
//
// WHY DAYS IS NOW SAMPLED, NOT DERIVED
// ────────────────────────────────────
// The old code set `days_since_last_rebalance = daysBetween(latestDate, row.date)`,
// i.e. a pure monotone function of the training-row index. Every market state was
// fused to exactly one calendar offset, so the label (and therefore the model)
// became a function of *position-in-time* — the model learned "later rows mean
// rebalance" and never had to look at the portfolio at all. `days` was collinear
// with the row index.
//
// Fix: sample `days_since_last_rebalance` independently for each row (seeded RNG
// for reproducibility) so that every (market state, time-since-rebalance)
// combination appears with comparable frequency, forcing the model to weigh all
// twelve features instead of memorising an index → label staircase.

/** Deterministic PRNG (mulberry32) so regenerating the dataset is reproducible. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Realistic rebalance cadence used when synthesising training rows. */
export const MIN_REBALANCE_DAYS = 7;
export const MAX_REBALANCE_DAYS = 250;

export function buildTrainingDataset(
  pf: PortfolioFeatures,
  marketRows: MarketRow[]
): LabeledDataset {
  const X: number[][] = [];
  const y: number[] = [];

  const rng = makeRandom(0xc0ffee);

  // Reserve the last row for prediction; train on rows [89, len-2]
  for (let i = 89; i < marketRows.length - 1; i++) {
    const mf = computeMarketFeatures(marketRows, i);
    if (!mf) continue;

    // Sample the time-since-rebalance independently of the market window.
    const simulatedDays = Math.floor(
      MIN_REBALANCE_DAYS + rng() * (MAX_REBALANCE_DAYS - MIN_REBALANCE_DAYS)
    );

    const fv = buildFeatureVector(pf, mf, simulatedDays);
    const label = labelFeatureVector(fv);
    X.push([...fv]);
    y.push(label);
  }

  const nRebalance = y.filter((l) => l === 1).length;
  const nHold = y.filter((l) => l === 0).length;

  return { X, y, nRebalance, nHold };
}

// ── Condition diagnostics (for result display) ────────────────────────────────

export interface ConditionResult {
  name: string;
  triggered: boolean;
  description: string;
}

export function evaluateConditions(fv: FeatureVector): ConditionResult[] {
  const [
    ,
    max_stock_weight,
    top3_concentration,
    total_weight_drift,
    ,
    portfolio_volatility,
    sector_concentration,
    days_since_last_rebalance,
    ,
    ,
    market_drawdown_90d,
    market_trend,
  ] = fv;

  return [
    {
      name: "Drift Crisis",
      triggered: total_weight_drift > 0.20 && max_stock_weight > 0.35,
      description: `Weight drift ${(total_weight_drift * 100).toFixed(1)}% (>20%) · Max weight ${(max_stock_weight * 100).toFixed(1)}% (>35%)`,
    },
    {
      name: "Market Shock",
      triggered: market_drawdown_90d < -0.15 && market_trend === 0,
      description: `90d drawdown ${(market_drawdown_90d * 100).toFixed(1)}% (<−15%) · Trend ${market_trend === 0 ? "bearish" : "bullish"}`,
    },
    {
      name: "Time Risk",
      triggered: days_since_last_rebalance > 90 && portfolio_volatility > VOLATILITY_THRESHOLD,
      description: `${days_since_last_rebalance} days since rebalance (>90) · Volatility ${portfolio_volatility.toFixed(4)} (>${VOLATILITY_THRESHOLD})`,
    },
    {
      name: "Concentration",
      triggered: top3_concentration > 0.60 && sector_concentration > 0.50,
      description: `Top-3 concentration ${(top3_concentration * 100).toFixed(1)}% (>60%) · Sector ${(sector_concentration * 100).toFixed(1)}% (>50%)`,
    },
  ];
}