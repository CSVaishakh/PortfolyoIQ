"use client";

import { useCallback, useRef, useState } from "react";
import { parsePortfolioFile, resolveTargetWeights, type PortfolioHolding } from "@/lib/portfolioParser";
import {
  MARKET_DATASET,
  MAX_MARKET_DATA_AGE_DAYS,
  MIN_MARKET_HISTORY_ROWS,
  assessMarketDataFreshness,
  getLatestMarketFeatures,
  parseNiftyCSV,
  type MarketFeatures,
  type MarketRow,
} from "@/lib/marketData";
import {
  MODEL_CONTRACT,
  buildFeatureVector,
  computeLabelScore,
  computePortfolioFeatures,
  evaluateConditions,
  standardizeFeatureVector,
  type ConditionResult,
  type FeatureVector,
  type PortfolioFeatures,
} from "@/lib/featureEngineering";
import { decideRebalance, type RebalanceDecision } from "@/lib/rebalanceEconomics";
import { fetchGlobalModel } from "@/lib/api";
import { formatDate, formatPercent } from "@/lib/format";
import type { MandateValues } from "@/lib/mandate";

const MARKET_CSV = "/dataset/nifty50-15y.csv";

/**
 * Federated contribution stays off until outcome-based labels replace the rule
 * oracle. Unchanged from the previous implementation — sending rule-derived
 * updates through FedAvg is worse than not training at all.
 */
const FEDERATED_TRAINING_ENABLED = false;

// ── Trace ─────────────────────────────────────────────────────────────────────

export type TraceStatus = "info" | "ok" | "warn" | "error";

export interface TraceEntry {
  id: number;
  message: string;
  status: TraceStatus;
}

// ── Blocking states (AN-20) ───────────────────────────────────────────────────

export interface BlockingState {
  title: string;
  /** What went wrong. */
  cause: string;
  /** What it means — always that a live recommendation is unavailable. */
  consequence: string;
  /** What the user should do next (CN-06). */
  action: string;
  /** Row- or column-level specifics, listed verbatim. */
  details?: string[];
}

export interface FailureState {
  title: string;
  message: string;
  action: string;
}

// ── Result ────────────────────────────────────────────────────────────────────

/** AN-25: the secondary signal is always labelled by provenance. */
export type SecondarySignal =
  | { kind: "global"; demo: boolean; probability: number; label: 0 | 1 }
  | { kind: "fallback"; probability: number; label: 0 | 1; reason: string }
  | { kind: "signed-out" };

export interface MarketContext {
  benchmark: string;
  provenance: string;
  latestDate: Date | null;
  ageDays: number;
  rowCount: number;
  features: MarketFeatures;
}

export interface AnalysisResult {
  decision: RebalanceDecision;
  holdings: PortfolioHolding[];
  portfolioFeatures: PortfolioFeatures;
  featureVector: FeatureVector;
  conditions: ConditionResult[];
  market: MarketContext;
  secondary: SecondarySignal;
  /** AN-22: surfaced on the result, not only in the trace. */
  targetNotes: string[];
  /** AN-07: per-row parse problems, kept separate from success messages. */
  rowWarnings: string[];
  completedAt: Date;
  contribution: { uploaded: boolean; samples: number } | null;
}

export type RunStatus = "idle" | "ready" | "running" | "complete" | "blocked" | "failed";

interface RunState {
  status: RunStatus;
  trace: TraceEntry[];
  result: AnalysisResult | null;
  blocking: BlockingState | null;
  failure: FailureState | null;
  /** Signature of the inputs this outcome was produced from (AN-46). */
  signature: string | null;
}

const INITIAL: RunState = {
  status: "idle",
  trace: [],
  result: null,
  blocking: null,
  failure: null,
  signature: null,
};

/**
 * Session cache for the 3,700-row market CSV (PF-07). Re-running an analysis
 * after editing the mandate should not refetch and reparse it.
 */
let cachedMarketRows: MarketRow[] | null = null;

async function loadMarketRows(signal: AbortSignal): Promise<MarketRow[]> {
  if (cachedMarketRows) return cachedMarketRows;
  const response = await fetch(MARKET_CSV, { signal });
  if (!response.ok) {
    throw new Error(`The bundled market dataset could not be loaded (HTTP ${response.status}).`);
  }
  const rows = parseNiftyCSV(await response.text());
  cachedMarketRows = rows;
  return rows;
}

export interface UseAnalysisRun {
  status: RunStatus;
  trace: TraceEntry[];
  result: AnalysisResult | null;
  blocking: BlockingState | null;
  failure: FailureState | null;
  /**
   * AN-46: true when the file or mandate changed after the displayed outcome
   * was produced. The result stays on screen, badged, rather than silently
   * describing inputs that are no longer visible.
   */
  stale: boolean;
  start: (input: StartInput) => Promise<void>;
  cancel: () => void;
  /** Clears everything — used when the selected file is replaced. */
  reset: () => void;
}

export interface StartInput {
  file: File;
  mandate: MandateValues;
  token: string | null;
  /** Opaque snapshot of the inputs; any change to it marks the result stale. */
  signature: string;
}

export function useAnalysisRun(currentSignature: string, hasFile: boolean): UseAnalysisRun {
  const [state, setState] = useState<RunState>(INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const traceId = useRef(0);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancel();
    traceId.current = 0;
    setState(INITIAL);
  }, [cancel]);

  const start = useCallback(async ({ file, mandate, token, signature }: StartInput) => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;

    const trace: TraceEntry[] = [];
    const push = (message: string, status: TraceStatus = "info") => {
      trace.push({ id: traceId.current++, message, status });
      // A fresh array each time so the live region re-announces (AN-16).
      setState((prev) => ({ ...prev, trace: [...trace] }));
    };

    const block = (blocking: BlockingState) => {
      setState({
        status: "blocked",
        trace: [...trace],
        // AN-21: no verdict survives a blocking state, including a stale one.
        result: null,
        blocking,
        failure: null,
        signature,
      });
    };

    setState({
      status: "running",
      trace: [],
      result: null,
      blocking: null,
      failure: null,
      signature,
    });

    try {
      // ── 1. Parse the portfolio file ───────────────────────────────────────
      push("Parsing portfolio file…");
      const { holdings, errors: parseErrors } = await parsePortfolioFile(file);

      const missingColumns = parseErrors.filter((e) => e.startsWith("Missing required column"));
      if (missingColumns.length) {
        block({
          title: "Required columns are missing",
          cause: `The uploaded file does not contain ${missingColumns.length === 1 ? "a required column" : "several required columns"}.`,
          consequence: "A live recommendation is unavailable until the file matches the template.",
          action: "Download the template again and copy your holdings into it without renaming the header row.",
          details: missingColumns,
        });
        return;
      }

      if (!holdings.length) {
        block({
          title: "No valid holdings were found",
          cause: "Every row in the file was rejected, or the file contained no data rows.",
          consequence: "A live recommendation is unavailable without at least one valid holding.",
          action: "Check the reasons below, correct those rows in the template, and upload it again.",
          details: parseErrors.length ? parseErrors : ["The file contained no data rows."],
        });
        return;
      }

      const rowWarnings = parseErrors.filter((e) => !e.startsWith("Missing required column"));
      for (const warning of rowWarnings) push(warning, "warn");
      push(
        `Portfolio parsed — ${holdings.length} holding${holdings.length === 1 ? "" : "s"} loaded${rowWarnings.length ? `, ${rowWarnings.length} row${rowWarnings.length === 1 ? "" : "s"} skipped` : ""}.`,
        "ok",
      );

      // ── 2. Resolve the target mandate ─────────────────────────────────────
      push("Resolving declared target weights…");
      const resolvedTargets = resolveTargetWeights(holdings);

      if (resolvedTargets.source === "missing") {
        block({
          title: "Target allocation is incomplete",
          cause: "At least one holding has no Target Weight %.",
          consequence:
            "A live recommendation is unavailable. The decision is target-relative: without a complete mandate there is nothing to measure drift against.",
          action:
            "Fill in Target Weight % for every holding in the template — the values may be any positive numbers; they are normalised to 100%.",
          details: resolvedTargets.notes,
        });
        return;
      }

      if (resolvedTargets.source === "invalid") {
        block({
          title: "Target weights do not total a positive number",
          cause: "The declared Target Weight % values sum to zero or less.",
          consequence: "A live recommendation is unavailable while the mandate cannot be normalised.",
          action: "Enter positive Target Weight % values that describe your intended allocation.",
          details: resolvedTargets.notes,
        });
        return;
      }
      push("Target mandate resolved from the declared Target Weight % column.", "ok");

      // ── 3. Market data and freshness ──────────────────────────────────────
      push(`Loading ${MARKET_DATASET.benchmark} market data…`);
      const marketRows = await loadMarketRows(controller.signal);
      const freshness = assessMarketDataFreshness(marketRows);

      if (!freshness.usable) {
        const tooShort = freshness.rowCount < MIN_MARKET_HISTORY_ROWS;
        // Composed here rather than reusing `freshness.reason`: that string
        // formats its date through the runtime's default locale, which renders
        // as US-style and contradicts DV-11 elsewhere on the same panel.
        const cause = tooShort
          ? `The bundled series carries ${freshness.rowCount} trading days; at least ${MIN_MARKET_HISTORY_ROWS} are needed.`
          : freshness.latestDate
            ? `Market data are stale — the latest price is from ${formatDate(freshness.latestDate)}, ${freshness.ageDays} days old, against a limit of ${MAX_MARKET_DATA_AGE_DAYS} days.`
            : "No market data could be read from the bundled source.";
        block({
          title: "Live recommendation unavailable",
          cause,
          consequence:
            "The economics depend on current market volatility, so no verdict is produced from prices this old.",
          action: tooShort
            ? `Refresh the bundled ${MARKET_DATASET.filename} so it carries at least ${MIN_MARKET_HISTORY_ROWS} trading days.`
            : `Refresh the bundled ${MARKET_DATASET.filename}; the freshness limit is ${MAX_MARKET_DATA_AGE_DAYS} days.`,
          details: [
            `Latest data: ${formatDate(freshness.latestDate)}`,
            `Age: ${freshness.ageDays} days (limit ${MAX_MARKET_DATA_AGE_DAYS})`,
            `Trading days available: ${freshness.rowCount} (minimum ${MIN_MARKET_HISTORY_ROWS})`,
          ],
        });
        return;
      }
      push(
        `Market data loaded — ${freshness.rowCount} trading days to ${formatDate(freshness.latestDate)}.`,
        "ok",
      );

      // ── 4. Portfolio features ─────────────────────────────────────────────
      push("Computing portfolio features…");
      const portfolioFeatures = computePortfolioFeatures(holdings);
      push(
        `Portfolio: ${portfolioFeatures.num_stocks} holdings · largest ${formatPercent(portfolioFeatures.max_stock_weight)} · sector concentration ${formatPercent(portfolioFeatures.sector_concentration)}.`,
        "ok",
      );

      // ── 5. Market features ────────────────────────────────────────────────
      push("Computing current market features…");
      const marketFeatures = getLatestMarketFeatures(marketRows);
      if (!marketFeatures) {
        block({
          title: "Live recommendation unavailable",
          cause: `Risk features need at least ${MIN_MARKET_HISTORY_ROWS} trading days of history; the bundled series is too short to compute them.`,
          consequence: "Without volatility and drawdown the benefit side of the trade-off cannot be estimated.",
          action: `Refresh the bundled ${MARKET_DATASET.filename} with a longer price history.`,
          details: [`Trading days available: ${freshness.rowCount}`],
        });
        return;
      }
      push(
        `Market: 30d return ${formatPercent(marketFeatures.market_return_30d, 2)} · 30d volatility ${formatPercent(marketFeatures.market_volatility_30d, 2)} · trend ${marketFeatures.market_trend === 1 ? "bullish" : "bearish"}.`,
        "ok",
      );

      // ── 6. Feature vector ─────────────────────────────────────────────────
      const featureVector = buildFeatureVector(
        portfolioFeatures,
        marketFeatures,
        mandate.daysSinceRebalance,
      ) as FeatureVector;
      push(`Feature vector constructed — ${featureVector.length} features.`, "ok");

      for (const note of resolvedTargets.notes) push(note, "warn");

      // ── 7. The decision. This is the product's answer. ────────────────────
      push("Evaluating target-relative economics…");
      const decision = decideRebalance(
        holdings,
        resolvedTargets.targets,
        marketFeatures.market_volatility_30d * Math.sqrt(252),
        {
          cashAvailableInr: mandate.cashAvailableInr,
          horizonDays: mandate.horizonDays,
          riskAversion: mandate.riskAversion,
          accountType: mandate.accountType,
        },
      );
      push(
        `Decision: ${decision.action} — estimated net benefit ${decision.netBenefitBps.toFixed(1)} bps over the review horizon.`,
        decision.action === "REBALANCE" ? "ok" : "info",
      );

      // ── 8. Secondary ML signal — explanatory only (AN-25) ─────────────────
      let secondary: SecondarySignal;

      if (!token) {
        push("Not signed in — the secondary model signal is unavailable.", "info");
        secondary = { kind: "signed-out" };
      } else {
        push("Fetching global model weights…");
        const modelResult = await fetchGlobalModel(token);

        let weights: { coef: number[][]; intercept: number[]; demo: boolean } | null = null;
        let unavailableReason = "";

        if (modelResult.ok) {
          const data = modelResult.data;
          const matchesContract =
            data.feature_version === MODEL_CONTRACT.featureVersion &&
            data.scaler_version === MODEL_CONTRACT.scalerVersion &&
            data.model_version === MODEL_CONTRACT.modelVersion;
          if (!matchesContract) {
            unavailableReason = "The global model uses an incompatible feature contract.";
            push(`${unavailableReason} Falling back to the rule-based reference.`, "warn");
          } else {
            weights = { coef: data.coef, intercept: data.intercept, demo: data.demo === true };
            push("Global model weights loaded.", "ok");
          }
        } else {
          unavailableReason = modelResult.error;
          push(`${unavailableReason} Falling back to the rule-based reference.`, "warn");
        }

        if (weights) {
          // Pure inference on standardized features — no local fit on a single
          // row, which would memorise this one portfolio and overwrite the
          // warm-started global weights.
          const { default: LogisticRegression } = await import("@/ts-model/logisticRegression");
          const model = new LogisticRegression({ C: 1.0, max_iter: 200, lr: 0.05 });
          model.setWeights(weights.coef, weights.intercept);
          const probability = model.predict_proba([standardizeFeatureVector(featureVector)])[0][1];
          secondary = {
            kind: "global",
            demo: weights.demo,
            probability,
            label: probability >= 0.5 ? 1 : 0,
          };
          push(
            `Secondary signal: ${(probability * 100).toFixed(1)}% model confidence in rebalancing.`,
            "ok",
          );
        } else {
          const fallback = computeLabelScore(featureVector);
          secondary = {
            kind: "fallback",
            probability: fallback.prob,
            label: fallback.label,
            reason: unavailableReason,
          };
        }
      }

      if (token && FEDERATED_TRAINING_ENABLED) {
        // Retained for when outcome-based labels land; see the flag comment.
        push("Federated contribution is enabled but no outcome-based dataset is available.", "warn");
      } else if (token) {
        push(
          "Model contributions are paused until outcome-based training data are available — nothing was uploaded.",
          "info",
        );
      }

      const result: AnalysisResult = {
        decision,
        holdings,
        portfolioFeatures,
        featureVector,
        conditions: evaluateConditions(featureVector),
        market: {
          benchmark: MARKET_DATASET.benchmark,
          provenance: MARKET_DATASET.provenance,
          latestDate: freshness.latestDate,
          ageDays: freshness.ageDays,
          rowCount: freshness.rowCount,
          features: marketFeatures,
        },
        secondary,
        targetNotes: resolvedTargets.notes,
        rowWarnings,
        completedAt: new Date(),
        contribution: null,
      };

      setState({
        status: "complete",
        trace: [...trace],
        result,
        blocking: null,
        failure: null,
        signature,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        setState({
          status: "ready",
          trace: [...trace],
          result: null,
          blocking: null,
          failure: null,
          signature: null,
        });
        return;
      }
      // GL-16: an exception becomes a legible message with a recovery action,
      // never a raw `Error.message` standing alone as the whole of the text.
      const detail = err instanceof Error ? err.message : String(err);
      setState({
        status: "failed",
        trace: [...trace],
        result: null,
        blocking: null,
        failure: {
          title: "The analysis could not be completed",
          message: `The run stopped before producing a verdict. Reported cause: ${detail}`,
          action: "Check the trace below for the last step that succeeded, then try the run again.",
        },
        signature,
      });
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [cancel]);

  // `idle` until a file exists; `ready` once one does and no run has produced an
  // outcome yet — the table in §8 of the spec.
  const status: RunStatus =
    state.status === "idle" ? (hasFile ? "ready" : "idle") : state.status;

  return {
    status,
    trace: state.trace,
    result: state.result,
    blocking: state.blocking,
    failure: state.failure,
    stale: state.signature !== null && state.signature !== currentSignature,
    start,
    cancel,
    reset,
  };
}
