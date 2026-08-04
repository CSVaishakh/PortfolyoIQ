"use client";

import { useRef, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { parsePortfolioFile, resolveTargetWeights } from "@/lib/portfolioParser";
import { MARKET_DATASET, parseNiftyCSV, getLatestMarketFeatures, assessMarketDataFreshness } from "@/lib/marketData";
import {
  computePortfolioFeatures,
  buildFeatureVector,
  buildTrainingDataset,
  standardizeFeatureVector,
  standardizeFeatureMatrix,
  computeLabelScore,
  evaluateConditions,
  MODEL_CONTRACT,
  type PortfolioFeatures,
  type FeatureVector,
  type ConditionResult,
} from "@/lib/featureEngineering";
import { decideRebalance, type AccountType, type RebalanceDecision } from "@/lib/rebalanceEconomics";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";
const MARKET_CSV = "/dataset/nifty50-15y.csv";
// Re-enable only after P2's outcome-based label/backtest pipeline replaces the
// former heuristic labels. Sending rule-oracle updates through FedAvg is worse
// than not training at all.
const FEDERATED_TRAINING_ENABLED = false;

// ── Types ─────────────────────────────────────────────────────────────────────

interface LogEntry {
  msg: string;
  status: "info" | "ok" | "warn" | "error";
}

type PredictionSource = "global" | "heuristic";

interface PredictionResult {
  label: 0 | 1;
  probability: number;
  source: PredictionSource;   // "global" = federated ML model, "heuristic" = fallback rule
  contributed: boolean;       // weights uploaded for federated learning
  contributionSamples: number;
  portfolioFeatures: PortfolioFeatures;
  conditions: ConditionResult[];
  featureVector: FeatureVector;
  decision: RebalanceDecision;
  globalModelIsDemo: boolean;
}

interface GlobalModelResponse {
  coef: number[][];
  intercept: number[];
  feature_version: number;
  scaler_version: number;
  model_version: number;
  demo?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysSince(date: string): number {
  const d = new Date(date);
  const now = new Date();
  return Math.max(0, Math.round((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function fmt(n: number, decimals = 2): string {
  return (n * 100).toFixed(decimals) + "%";
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InteractClient() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [lastRebalanceDate, setLastRebalanceDate] = useState("");
  const [cashAvailable, setCashAvailable] = useState("0");
  const [horizonDays, setHorizonDays] = useState("365");
  const [riskAversion, setRiskAversion] = useState("3");
  const [accountType, setAccountType] = useState<AccountType>("taxable");
  const [dragging, setDragging] = useState(false);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    setSignedIn(!!localStorage.getItem("token"));
  }, []);

  function handleSignOut() {
    localStorage.removeItem("token");
    router.push("/auth");
  }

  function addLog(msg: string, status: LogEntry["status"] = "info") {
    setLog((prev) => [...prev, { msg, status }]);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) { setFile(dropped); setResult(null); setLog([]); }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    if (picked) { setFile(picked); setResult(null); setLog([]); }
  }

  // ── Main pipeline ───────────────────────────────────────────────────────────

  async function runPrediction() {
    if (!file) return;
    setRunning(true);
    setResult(null);
    setLog([]);

    try {
      // ── Step 1: Parse portfolio file ────────────────────────────────────────
      addLog("Parsing portfolio file…");
      const { holdings, errors: parseErrors } = await parsePortfolioFile(file);

      for (const e of parseErrors) {
        addLog(e, e.startsWith("Missing") ? "error" : "warn");
      }
      if (!holdings.length) {
        addLog("No valid holdings found. Make sure you are using the provided template.", "error");
        setRunning(false);
        return;
      }
      const resolvedTargets = resolveTargetWeights(holdings);
      if (resolvedTargets.source !== "declared") {
        for (const note of resolvedTargets.notes) addLog(note, "error");
        addLog("A live recommendation is unavailable until a complete target allocation is supplied.", "error");
        return;
      }
      addLog(`Portfolio parsed — ${holdings.length} holdings loaded.`, "ok");

      // ── Step 2: Load market data (latest row only needed for features) ───────
      addLog(`Loading ${MARKET_DATASET.benchmark} market data…`);
      const csvText = await fetch(MARKET_CSV).then((r) => r.text());
      const marketRows = parseNiftyCSV(csvText);
      const freshness = assessMarketDataFreshness(marketRows);
      if (!freshness.usable) {
        addLog(freshness.reason, "error");
        return;
      }
      addLog(
        `Market data loaded — ${freshness.rowCount} trading days from ${MARKET_DATASET.coverageStart}. ${freshness.reason}`,
        "ok",
      );

      // ── Step 3: Compute portfolio features ───────────────────────────────────
      addLog("Computing portfolio features…");
      const pf = computePortfolioFeatures(holdings);
      addLog(
        `Portfolio: ${pf.num_stocks} stocks · max weight ${fmt(pf.max_stock_weight)} · ` +
        `drift ${fmt(pf.total_weight_drift)} · sector conc. ${fmt(pf.sector_concentration)}`,
        "ok"
      );

      // ── Step 4: Compute current market features ───────────────────────────────
      addLog("Computing current market features…");
      const mf = getLatestMarketFeatures(marketRows);
      if (!mf) {
        addLog("Not enough market history to compute features (need ≥ 90 trading days).", "error");
        setRunning(false);
        return;
      }
      addLog(
        `Market: 30d return ${fmt(mf.market_return_30d)} · ` +
        `30d vol ${fmt(mf.market_volatility_30d)} · ` +
        `90d drawdown ${fmt(mf.market_drawdown_90d)} · ` +
        `trend ${mf.market_trend === 1 ? "bullish" : "bearish"}`,
        "ok"
      );

      // ── Step 5: Build feature vector ──────────────────────────────────────────
      const daysRebalance = lastRebalanceDate ? daysSince(lastRebalanceDate) : 0;
      const fv = buildFeatureVector(pf, mf, daysRebalance) as FeatureVector;
      for (const note of resolvedTargets.notes) addLog(note, "warn");
      const decision = decideRebalance(
        holdings,
        resolvedTargets.targets,
        mf.market_volatility_30d * Math.sqrt(252),
        {
          cashAvailableInr: Number(cashAvailable),
          horizonDays: Number(horizonDays),
          riskAversion: Number(riskAversion),
          accountType,
        },
      );
      addLog(
        `Economic decision: ${decision.action} — estimated net benefit ${decision.netBenefitBps.toFixed(1)} bps over the review horizon.`,
        decision.action === "REBALANCE" ? "ok" : "info",
      );
      addLog(
        `Feature vector [num_stocks=${fv[0]}, max_wt=${fv[1].toFixed(3)}, top3=${fv[2].toFixed(3)}, ` +
        `drift=${fv[3].toFixed(3)}, ret=${fv[4].toFixed(4)}, vol=${fv[5].toFixed(6)}, ` +
        `sec=${fv[6].toFixed(3)}, days_since_rebalance=${fv[7]}, ` +
        `mkt_ret=${fv[8].toFixed(4)}, mkt_vol=${fv[9].toFixed(4)}, ` +
        `drawdown=${fv[10].toFixed(4)}, trend=${fv[11]}]`,
        "info"
      );

      // ── Step 6: Load global model weights ────────────────────────────────────
      addLog("Fetching global model weights…");
      const token = localStorage.getItem("token");
      let initialCoef: number[][] | null = null;
      let initialIntercept: number[] | null = null;
      let hasGlobalModel = false;
      let globalModelIsDemo = false;

      if (token) {
        try {
          const res = await fetch(`${API_BASE}/client/model/global`, {
            headers: { token: token },
          });
          if (res.ok) {
            const data = await res.json() as GlobalModelResponse;
            const matchesContract = data.feature_version === MODEL_CONTRACT.featureVersion
              && data.scaler_version === MODEL_CONTRACT.scalerVersion
              && data.model_version === MODEL_CONTRACT.modelVersion;
            if (!matchesContract) {
              addLog("Global model uses an incompatible feature contract — falling back to the rule-based assessment.", "warn");
            } else {
              initialCoef = data.coef;
              initialIntercept = data.intercept;
              globalModelIsDemo = data.demo === true;
              hasGlobalModel = !!initialCoef && !!initialIntercept;
              addLog("Global weights loaded.", "ok");
            }
          } else {
            addLog("No global model seeded yet — falling back to the rule-based assessment.", "warn");
          }
        } catch {
          addLog("Could not reach server — falling back to the rule-based assessment.", "warn");
        }
      } else {
        addLog("Not signed in — falling back to the rule-based assessment.", "warn");
      }

      // ── Step 7: Predict with the GLOBAL model only ───────────────────────────
      // No local fit on the single feature vector. A 1-sample fit memorises that
      // one portfolio (200 epochs over one row → near-perfect overfit) and wipes
      // the warm-started global weights; averaging such memorisations across users
      // in FedAvg biased the global model toward whichever features had the
      // largest raw magnitude (days, drift). Prediction is now pure inference on
      // standardized features, so the global model's weights — and not a replayed
      // rule — drive the verdict.
      addLog("Loading global model…");
      const { default: LogisticRegression } = await import("@/ts-model/logisticRegression");
      const model = new LogisticRegression({ C: 1.0, max_iter: 200, lr: 0.05 });

      let predictedLabel: 0 | 1;
      let pRebalance: number;
      let source: PredictionSource;

      if (hasGlobalModel) {
        model.setWeights(initialCoef!, initialIntercept!);
        const probas = model.predict_proba([standardizeFeatureVector(fv)]);
        pRebalance = probas[0][1];
        predictedLabel = pRebalance >= 0.5 ? 1 : 0;
        source = "global";
      } else {
        // No seeded global model anywhere in the fleet — use the explanatory
        // rule (the same scoring that synthesizes training labels) as a fallback.
        const fallback = computeLabelScore(fv);
        pRebalance = fallback.prob;
        predictedLabel = fallback.label;
        source = "heuristic";
      }

      const confidence = Math.max(pRebalance, 1 - pRebalance);
      const conditions = evaluateConditions(fv);
      addLog(
        `Prediction ${source === "global" ? "(global ML model)" : "(rule fallback)"}: ` +
        `${predictedLabel === 1 ? "REBALANCE" : "HOLD"} — confidence ${(confidence * 100).toFixed(1)}%`,
        "ok"
      );

      // ── Step 8: Federated contribution on the FULL synthetic dataset ─────────
      // If a global model exists, contribute genuinely useful gradient signal:
      // train on the complete synthetic dataset built from this portfolio across
      // the whole market history (hundreds of rows, decoupled days, real variety)
      // — not on a single memorised point. Weights are uploaded with the true
      // sample count so the server can run sample-weighted FedAvg.
      let contributed = false;
      let contributionSamples = 0;

      if (token && hasGlobalModel && FEDERATED_TRAINING_ENABLED) {
        addLog("Building synthetic local dataset for FL contribution…");
        const localDataset = buildTrainingDataset(pf, marketRows);

        if (localDataset.nRebalance === 0 || localDataset.nHold === 0) {
          addLog(
            "Skipping contribution — synthetic data is single-class; training on it would add noise.",
            "warn"
          );
        } else {
          addLog(
            `Synthetic dataset: ${localDataset.X.length} rows ` +
            `(${localDataset.nRebalance} rebalance / ${localDataset.nHold} hold).`,
            "ok"
          );

          const Xs = standardizeFeatureMatrix(localDataset.X);
          const ys = localDataset.y;

          // Warm-start from the global model, then fine-tune on the local dataset
          // with early stopping on a held-out 20% split to avoid degenerate overfit.
          model.setWeights(initialCoef!, initialIntercept!);

          const splitAt = Math.floor(Xs.length * 0.8);
          const trX = Xs.slice(0, splitAt);
          const trY = ys.slice(0, splitAt);
          const vaX = Xs.slice(splitAt);
          const vaY = ys.slice(splitAt);

          let bestValAcc = -1;
          let patience = 5;
          const bestWeights: { value: { coef: number[][]; intercept: number[] } | null } = { value: null };

          await model.fit(trX, trY, () => {
            const valAcc = model.score(vaX, vaY);
            if (valAcc > bestValAcc) {
              bestValAcc = valAcc;
              patience = 5;
              bestWeights.value = model.getWeights();
            } else {
              patience -= 1;
              if (patience <= 0) return false; // early stop
            }
            return true;
          });

          if (bestWeights.value) {
            model.setWeights(bestWeights.value.coef, bestWeights.value.intercept);
          }
          addLog(
            `Local fine-tune complete — best held-out accuracy ${(bestValAcc * 100).toFixed(1)}%.`,
            bestValAcc > 0 ? "ok" : "warn"
          );

          addLog("Uploading model weights to server…");
          try {
            const { coef, intercept } = model.getWeights();
            const res = await fetch(`${API_BASE}/client/model/weights`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                token: token,
              },
              body: JSON.stringify({
                coef,
                intercept,
                n_samples: localDataset.X.length,
                feature_version: MODEL_CONTRACT.featureVersion,
                scaler_version: MODEL_CONTRACT.scalerVersion,
                model_version: MODEL_CONTRACT.modelVersion,
                validation_auc: bestValAcc,
              }),
            });
            if (res.ok) {
              contributed = true;
              contributionSamples = localDataset.X.length;
              addLog("Weights uploaded — contributing to federated model.", "ok");
            } else {
              const body = await res.json().catch(() => ({}));
              addLog(`Weight upload failed (${res.status}): ${body.error ?? "server error"}.`, "warn");
            }
          } catch {
            addLog("Weight upload failed — could not reach server.", "warn");
          }
        }
      } else if (token && hasGlobalModel) {
        addLog("Federated contribution is paused until outcome-based training data are available.", "warn");
      } else if (token && !hasGlobalModel) {
        addLog("No global model to warm-start from — contribution skipped.", "warn");
      } else {
        addLog("Not signed in — weights not uploaded.", "warn");
      }

      // ── Done ──────────────────────────────────────────────────────────────────
      setResult({
        label: decision.action === "REBALANCE" ? 1 : 0,
        probability: pRebalance,
        source,
        contributed,
        contributionSamples,
        portfolioFeatures: pf,
        conditions,
        featureVector: fv,
        decision,
        globalModelIsDemo,
      });

    } catch (err) {
      addLog(`Unexpected error: ${(err as Error).message}`, "error");
    } finally {
      setRunning(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const canRun = !!file && !running;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-5xl mx-auto border-b border-zinc-800">
        <Link href="/" className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-indigo-500 flex items-center justify-center text-white font-bold text-xs">
            P
          </div>
          <span className="font-semibold tracking-tight">PortfolioIQ</span>
        </Link>
        {signedIn ? (
          <button
            onClick={handleSignOut}
            className="text-sm text-zinc-400 hover:text-red-400 transition-colors"
          >
            Sign Out
          </button>
        ) : (
          <Link href="/auth" className="text-sm text-zinc-400 hover:text-white transition-colors">
            Sign In
          </Link>
        )}
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-12 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Portfolio Analysis</h1>
          <p className="text-zinc-400 text-sm mt-1">
            Fill in the template with your holdings, upload it, and get an AI rebalancing recommendation.
          </p>
        </div>

        {/* ── Template download banner ─────────────────────────────────────── */}
        <div className="rounded-xl border border-indigo-500/30 bg-indigo-500/5 px-5 py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-indigo-300">Step 1 — Download the template</p>
            <p className="text-xs text-zinc-400 mt-0.5">
              Fill in your holdings.{" "}
              <span className="text-zinc-300 font-mono">Symbol · ISIN · Sector · Quantity · Average Buy Price · Current Price · Target Weight % · Purchase Date</span>
            </p>
          </div>
          <a
            href="/templates/portfolio-template.xlsx"
            download="portfolio-template.xlsx"
            className="shrink-0 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-sm font-medium transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            Download template
          </a>
        </div>

        {/* ── Upload + Config row ─────────────────────────────────────────── */}
        <div className="grid md:grid-cols-2 gap-4">
          {/* Upload zone */}
          <div>
            <p className="text-xs font-medium text-zinc-400 mb-2">Step 2 — Upload your filled template</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleFileDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`rounded-xl border-2 border-dashed p-8 flex flex-col items-center justify-center cursor-pointer transition-colors ${
                dragging
                  ? "border-indigo-400 bg-indigo-500/10"
                  : file
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-zinc-700 hover:border-zinc-500"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={handleFileChange}
              />
              <div className="text-3xl mb-3">{file ? "📄" : "⬆"}</div>
              {file ? (
                <>
                  <p className="text-sm font-medium text-emerald-400">{file.name}</p>
                  <p className="text-xs text-zinc-500 mt-1">Click to replace</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium">Drop your filled template here</p>
                  <p className="text-xs text-zinc-500 mt-1">Accepts .xlsx or .csv</p>
                </>
              )}
            </div>
          </div>

          {/* Config */}
          <div>
            <p className="text-xs font-medium text-zinc-400 mb-2">Step 3 — Configure &amp; run</p>
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6 space-y-5">
              <p className="text-xs text-yellow-300">Target Weight % is required for every holding. Prices, tax, and costs remain estimates.</p>
              <div>
                <label className="block text-xs font-medium text-zinc-400 mb-2">
                  When did you last rebalance?
                </label>
                <input
                  type="date"
                  value={lastRebalanceDate}
                  max={new Date().toISOString().split("T")[0]}
                  onChange={(e) => setLastRebalanceDate(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors scheme-dark"
                />
                {lastRebalanceDate && (
                  <p className="text-xs text-zinc-500 mt-1.5">
                    {daysSince(lastRebalanceDate)} days ago
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-medium text-zinc-400">
                  Available cash (₹)
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={cashAvailable}
                    onChange={(e) => setCashAvailable(e.target.value)}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-400">
                  Horizon (days)
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={horizonDays}
                    onChange={(e) => setHorizonDays(e.target.value)}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-400">
                  Risk preference (0–10)
                  <input
                    type="number"
                    min="0"
                    max="10"
                    step="0.5"
                    value={riskAversion}
                    onChange={(e) => setRiskAversion(e.target.value)}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                  />
                </label>
                <label className="block text-xs font-medium text-zinc-400">
                  Account type
                  <select
                    value={accountType}
                    onChange={(e) => setAccountType(e.target.value as AccountType)}
                    className="w-full mt-2 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm focus:outline-none focus:border-indigo-500"
                  >
                    <option value="taxable">Taxable</option>
                    <option value="tax-advantaged">Tax-advantaged</option>
                  </select>
                </label>
              </div>

              <button
                onClick={runPrediction}
                disabled={!canRun}
                className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {running ? (
                  <>
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Running…
                  </>
                ) : (
                  "Run Prediction"
                )}
              </button>
              {!file && (
                <p className="text-xs text-zinc-600 text-center">Upload your filled template to continue</p>
              )}
            </div>
          </div>
        </div>

        {/* ── Activity Log ────────────────────────────────────────────────── */}
        {log.length > 0 && (
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
            <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
              Activity Log
            </h2>
            <ul className="space-y-1.5">
              {log.map((entry, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-0.5 shrink-0">
                    {entry.status === "ok"    && <span className="text-emerald-400">✓</span>}
                    {entry.status === "warn"  && <span className="text-yellow-400">⚠</span>}
                    {entry.status === "error" && <span className="text-red-400">✗</span>}
                    {entry.status === "info"  && <span className="text-zinc-500">·</span>}
                  </span>
                  <span className={
                    entry.status === "ok"    ? "text-zinc-200"
                    : entry.status === "warn"  ? "text-yellow-300"
                    : entry.status === "error" ? "text-red-300"
                    : "text-zinc-400"
                  }>
                    {entry.msg}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* ── Result ──────────────────────────────────────────────────────── */}
        {result && (
          <div className="space-y-4">
            {/* Main verdict */}
            <div className={`rounded-xl border p-6 ${
              result.label === 1
                ? "border-orange-500/40 bg-orange-500/5"
                : "border-emerald-500/40 bg-emerald-500/5"
            }`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest text-zinc-400 mb-1">
                    Recommendation
                  </p>
                  <p className={`text-3xl font-bold ${result.label === 1 ? "text-orange-400" : "text-emerald-400"}`}>
                    {result.label === 1 ? "⚖ Rebalance" : "✓ Hold"}
                  </p>
                  <p className="text-sm text-zinc-400 mt-1">
                    Estimated net economic benefit: <span className="text-white font-medium">{result.decision.netBenefitBps.toFixed(1)} bps</span>
                    {" · "}implementation cost: {result.decision.costBps.toFixed(1)} bps
                  </p>
                </div>
                <div className="text-right text-xs text-zinc-500 space-y-0.5">
                  <p>
                    {result.source === "global"
                      ? `${result.globalModelIsDemo ? "Synthetic demo" : "Secondary global"} ML signal · P(rebalance) ${(result.probability * 100).toFixed(1)}%`
                      : "Secondary ML signal unavailable"}
                  </p>
                  {result.contributed && (
                    <p className="text-indigo-400">
                      ✓ Contributed to FL · {result.contributionSamples} samples
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Target-relative decision</h2>
              <p className="text-sm text-zinc-300">{result.decision.reasons[0]}</p>
              <p className="text-xs text-zinc-500 mt-2">Tracking error proxy {(result.decision.trackingError * 100).toFixed(2)}% · turnover {(result.decision.turnover * 100).toFixed(1)}% · estimated tax {result.decision.taxBps.toFixed(1)} bps</p>
              <p className="text-xs text-zinc-500 mt-1">Cash reconciliation: ₹{result.decision.openingCashInr.toLocaleString("en-IN")} available → ₹{result.decision.endingCashInr.toLocaleString("en-IN", { maximumFractionDigits: 0 })} after proposed trades, estimated tax, and costs.</p>
              {result.decision.caveats.map((caveat) => <p key={caveat} className="text-xs text-yellow-300 mt-1">{caveat}</p>)}
            </div>

            {result.decision.trades.some((trade) => trade.tradeShares !== 0) && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 overflow-x-auto">
                <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Executable trade list</h2>
                <table className="w-full text-sm">
                  <thead className="text-xs text-zinc-500 text-left border-b border-zinc-800">
                    <tr><th className="pb-2 font-medium">Holding</th><th className="pb-2 font-medium">Current</th><th className="pb-2 font-medium">Target</th><th className="pb-2 font-medium text-right">Order</th><th className="pb-2 font-medium text-right">Estimated value</th></tr>
                  </thead>
                  <tbody>
                    {result.decision.trades.filter((trade) => trade.tradeShares !== 0).map((trade) => (
                      <tr key={trade.symbol} className="border-b border-zinc-800/60">
                        <td className="py-2 text-zinc-200">{trade.symbol}</td>
                        <td className="py-2 text-zinc-400">{fmt(trade.currentWeight, 1)}</td>
                        <td className="py-2 text-zinc-400">{fmt(trade.targetWeight, 1)}</td>
                        <td className={trade.tradeShares > 0 ? "py-2 text-right text-emerald-400" : "py-2 text-right text-orange-400"}>{trade.tradeShares > 0 ? `Buy ${trade.tradeShares}` : `Sell ${-trade.tradeShares}`}</td>
                        <td className="py-2 text-right text-zinc-200">₹{Math.abs(trade.tradeValueInr).toLocaleString("en-IN", { maximumFractionDigits: 0 })}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Condition groups */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Condition Groups
              </h2>
              <div className="grid sm:grid-cols-2 gap-3">
                {result.conditions.map((c) => (
                  <div key={c.name} className={`rounded-lg p-3 border ${
                    c.triggered
                      ? "border-orange-500/40 bg-orange-500/5"
                      : "border-zinc-700 bg-zinc-800/30"
                  }`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className={c.triggered ? "text-orange-400" : "text-zinc-500"}>
                        {c.triggered ? "●" : "○"}
                      </span>
                      <span className={`text-sm font-medium ${c.triggered ? "text-orange-300" : "text-zinc-300"}`}>
                        {c.name}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 pl-4">{c.description}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Portfolio stats */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Portfolio Stats
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "Stocks",              value: result.portfolioFeatures.num_stocks.toString() },
                  { label: "Max Weight",           value: fmt(result.portfolioFeatures.max_stock_weight) },
                  { label: "Top-3 Concentration", value: fmt(result.portfolioFeatures.top3_concentration) },
                  { label: "Weight Drift",         value: fmt(result.portfolioFeatures.total_weight_drift) },
                  { label: "Portfolio Return",     value: fmt(result.portfolioFeatures.portfolio_return) },
                  { label: "Volatility",           value: result.portfolioFeatures.portfolio_volatility.toFixed(5) },
                  { label: "Sector Conc.",         value: fmt(result.portfolioFeatures.sector_concentration) },
                  { label: "Days Since Rebal.",    value: result.featureVector[7].toString() },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-xs text-zinc-500">{s.label}</p>
                    <p className="text-sm font-semibold mt-0.5">{s.value}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Market conditions */}
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
              <h2 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
                Current Market Conditions ({MARKET_DATASET.benchmark})
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {[
                  { label: "30d Return",     value: fmt(result.featureVector[8]) },
                  { label: "30d Volatility", value: fmt(result.featureVector[9]) },
                  { label: "90d Drawdown",   value: fmt(result.featureVector[10]) },
                  { label: "Trend",          value: result.featureVector[11] === 1 ? "Bullish" : "Bearish" },
                ].map((s) => (
                  <div key={s.label}>
                    <p className="text-xs text-zinc-500">{s.label}</p>
                    <p className={`text-sm font-semibold mt-0.5 ${
                      s.label === "Trend"
                        ? result.featureVector[11] === 1 ? "text-emerald-400" : "text-red-400"
                        : ""
                    }`}>
                      {s.value}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
