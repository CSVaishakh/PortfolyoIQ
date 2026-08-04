export interface MarketRow {
  date: Date;
  close: number;
}

export interface MarketFeatures {
  market_return_30d: number;
  market_volatility_30d: number;
  market_drawdown_90d: number;
  market_trend: number; // 1 = bullish, 0 = bearish
}

export const MARKET_DATASET = {
  benchmark: "NIFTY 50",
  filename: "nifty50-15y.csv",
  coverageStart: "2011-08-01",
  /** Update this provenance text whenever the checked-in source is refreshed. */
  provenance: "Bundled daily NIFTY 50 OHLCV CSV supplied by the project owner",
} as const;

/**
 * Freshness service-level objective. Five days covers a normal weekend plus a
 * market holiday; anything older is treated as unusable for a live decision.
 */
export const MAX_MARKET_DATA_AGE_DAYS = 5;

/** Trading days needed before the 90-day drawdown and MA50 features exist. */
export const MIN_MARKET_HISTORY_ROWS = 90;

export interface MarketDataFreshness {
  usable: boolean;
  latestDate: Date | null;
  ageDays: number;
  rowCount: number;
  reason: string;
}

/**
 * Fail-closed freshness check.
 *
 * A stale or short market series must block a live recommendation rather than
 * quietly producing one from old prices, so this returns an explicit unusable
 * state with the reason to surface to the user.
 */
export function assessMarketDataFreshness(
  rows: MarketRow[],
  now: Date = new Date(),
  maxAgeDays: number = MAX_MARKET_DATA_AGE_DAYS,
): MarketDataFreshness {
  const latestDate = rows.at(-1)?.date ?? null;
  if (!latestDate) {
    return {
      usable: false,
      latestDate: null,
      ageDays: Infinity,
      rowCount: rows.length,
      reason: "No market data could be read from the bundled source. A live recommendation is unavailable.",
    };
  }

  const ageDays = Math.floor((now.getTime() - latestDate.getTime()) / 86_400_000);

  if (rows.length < MIN_MARKET_HISTORY_ROWS) {
    return {
      usable: false,
      latestDate,
      ageDays,
      rowCount: rows.length,
      reason:
        `Market data hold only ${rows.length} trading days; at least ${MIN_MARKET_HISTORY_ROWS} are required `
        + "for the 90-day risk features. A live recommendation is unavailable.",
    };
  }

  if (ageDays > maxAgeDays) {
    return {
      usable: false,
      latestDate,
      ageDays,
      rowCount: rows.length,
      reason:
        `Market data are stale (latest ${latestDate.toLocaleDateString()}, ${ageDays} days old; `
        + `the limit is ${maxAgeDays} days). A live recommendation is unavailable.`,
    };
  }

  return {
    usable: true,
    latestDate,
    ageDays,
    rowCount: rows.length,
    reason: `Market data current to ${latestDate.toLocaleDateString()} (${ageDays} days old); source: ${MARKET_DATASET.provenance}.`,
  };
}

const MONTH_INDEX: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4,  JUN: 5,
  JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

function parseMarketDate(s: string): Date | null {
  // Supports both the legacy "27-FEB-2026" file and ISO dates from the
  // maintained NIFTY 50 source.
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (iso) {
    const date = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return date.getFullYear() === Number(iso[1]) && date.getMonth() === Number(iso[2]) - 1 && date.getDate() === Number(iso[3])
      ? date
      : null;
  }
  const [day, mon, year] = s.trim().split("-");
  const month = MONTH_INDEX[mon?.toUpperCase()];
  if (!day || !year || month === undefined) return null;
  const date = new Date(Number(year), month, Number(day));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function parseNiftyCSV(text: string): MarketRow[] {
  const lines = text.replace(/^\uFEFF/, "").split("\n");
  const rows: MarketRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(",");
    const date = parseMarketDate(cols[0] ?? "");
    const close = Number.parseFloat(cols[4] ?? "");
    if (!date || !Number.isFinite(close) || close <= 0) continue;
    rows.push({ date, close });
  }

  // Ensure chronological order (oldest first)
  return rows.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Compute all four market features for the trading day at `idx`.
 * Requires idx >= 89 (need 90 days for drawdown and 50 for MA50).
 * Returns null if there is insufficient history.
 */
export function computeMarketFeatures(rows: MarketRow[], idx: number): MarketFeatures | null {
  if (idx < 89) return null;

  const closes = rows.map((r) => r.close);

  // ── Market Return 30d ─────────────────────────────────────────────────────
  // Mr30 = Close[t] / Close[t-30] − 1
  const market_return_30d = closes[idx] / closes[idx - 30] - 1;

  // ── Market Volatility 30d ─────────────────────────────────────────────────
  // Std-dev of daily returns over the last 30 trading days
  const dailyReturns: number[] = [];
  for (let i = idx - 29; i <= idx; i++) {
    dailyReturns.push(closes[i] / closes[i - 1] - 1);
  }
  const mean = dailyReturns.reduce((s, r) => s + r, 0) / dailyReturns.length;
  const variance = dailyReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / dailyReturns.length;
  const market_volatility_30d = Math.sqrt(variance);

  // ── Market Drawdown 90d ───────────────────────────────────────────────────
  // Dt = (Close[t] − max(Close[t−89..t])) / max(Close[t−89..t])
  let hc90 = -Infinity;
  for (let i = idx - 89; i <= idx; i++) {
    if (closes[i] > hc90) hc90 = closes[i];
  }
  const market_drawdown_90d = (closes[idx] - hc90) / hc90;

  // ── Market Trend ──────────────────────────────────────────────────────────
  // MA20 vs MA50 — 1 if bullish, 0 if bearish
  const ma20 = closes.slice(idx - 19, idx + 1).reduce((s, c) => s + c, 0) / 20;
  const ma50 = closes.slice(idx - 49, idx + 1).reduce((s, c) => s + c, 0) / 50;
  const market_trend = ma20 > ma50 ? 1 : 0;

  return { market_return_30d, market_volatility_30d, market_drawdown_90d, market_trend };
}

/** Latest (most recent) market features — used for the live prediction row. */
export function getLatestMarketFeatures(rows: MarketRow[]): MarketFeatures | null {
  return computeMarketFeatures(rows, rows.length - 1);
}

export function daysBetween(a: Date, b: Date): number {
  return Math.round(Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
}
