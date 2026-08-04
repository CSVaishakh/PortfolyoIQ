"use client";

import { useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

interface FedAvgResult {
  participants: number;
  globalModel: { serialno: number; timestamp: string };
  modelService: string;
}

interface SeedResult {
  message: string;
  n_samples: number;
  n_features: number;
  classes: number[];
  globalModel: { serialno: number; timestamp: string };
}

type Stage = "locked" | "unlocked" | "running" | "seeding" | "done" | "seeded" | "error";

export default function TrainClient() {
  const [stage, setStage] = useState<Stage>("locked");
  const [secret, setSecret] = useState("");
  const [secretError, setSecretError] = useState("");
  const [fedAvgResult, setFedAvgResult] = useState<FedAvgResult | null>(null);
  const [seedResult, setSeedResult] = useState<SeedResult | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  // ── Secret gate ─────────────────────────────────────────────────────────────

  async function handleUnlock(e: React.FormEvent) {
    e.preventDefault();
    setSecretError("");

    // Validate by hitting the train endpoint with the secret (dry-check)
    // We use a probe: if the secret is wrong the server will 403 immediately.
    const res = await fetch(`${API_BASE}/model/train`, {
      method: "POST",
      headers: { "x-admin-secret": secret },
    }).catch(() => null);

    if (!res) {
      setSecretError("Could not reach the server.");
      return;
    }

    if (res.status === 403) {
      setSecretError("Incorrect secret. Access denied.");
      return;
    }

    // Any non-403 means the secret was accepted — proceed to unlocked panel
    const data = await res.json();
    if (res.ok || res.status === 207) {
      setFedAvgResult(data as FedAvgResult);
      setStage("done");
    } else {
      // e.g. 400 — no user weights yet, but secret was valid
      setFedAvgResult(null);
      setErrorMsg(data.error ?? "Server error");
      setStage("unlocked");
    }
  }

  // ── FedAvg round ────────────────────────────────────────────────────────────

  async function handleTrain() {
    setStage("running");
    setFedAvgResult(null);
    setErrorMsg("");

    const res = await fetch(`${API_BASE}/model/train`, {
      method: "POST",
      headers: { "x-admin-secret": secret },
    }).catch(() => null);

    if (!res) { setErrorMsg("Could not reach the server."); setStage("error"); return; }

    const data = await res.json();
    if (res.status === 403) { setErrorMsg("Secret rejected."); setStage("locked"); return; }
    if (!res.ok && res.status !== 207) { setErrorMsg(data.error ?? "Training failed."); setStage("error"); return; }

    setFedAvgResult(data as FedAvgResult);
    setStage("done");
  }

  // ── Seed from demo-dataset.csv ────────────────────────────────────────────────────

  async function handleSeed() {
    setStage("seeding");
    setSeedResult(null);
    setErrorMsg("");

    const res = await fetch(`${API_BASE}/model/seed`, {
      method: "POST",
      headers: { "x-admin-secret": secret },
    }).catch(() => null);

    if (!res) { setErrorMsg("Could not reach the server."); setStage("error"); return; }

    const data = await res.json();
    if (res.status === 403) { setErrorMsg("Secret rejected."); setStage("locked"); return; }
    if (!res.ok) { setErrorMsg(data.error ?? "Seeding failed."); setStage("error"); return; }

    setSeedResult(data as SeedResult);
    setStage("seeded");
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex items-center justify-center px-4">
      {/* background glow */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/3 left-1/2 -translate-x-1/2 w-[500px] h-[500px] bg-violet-700/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md space-y-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-2xl mx-auto mb-4">
            ⚙
          </div>
          <h1 className="text-xl font-bold">Admin — Train Global Model</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Runs FedAvg over all client weights and pushes the result to the model service.
          </p>
        </div>

        {/* ── Stage: locked ─────────────────────────────────────────────── */}
        {stage === "locked" && (
          <form onSubmit={handleUnlock} className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-7 space-y-4">
            <div>
              <label className="block text-xs font-medium text-zinc-400 mb-1.5">
                Admin secret
              </label>
              <input
                type="password"
                value={secret}
                onChange={(e) => { setSecret(e.target.value); setSecretError(""); }}
                placeholder="Enter admin secret…"
                required
                className="w-full px-4 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-white text-sm placeholder:text-zinc-500 focus:outline-none focus:border-violet-500 transition-colors"
              />
              {secretError && (
                <p className="text-xs text-red-400 mt-2">{secretError}</p>
              )}
            </div>
            <button
              type="submit"
              className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold transition-colors"
            >
              Authenticate &amp; Train
            </button>
          </form>
        )}

        {/* ── Stage: unlocked / running / seeding / error — action panel ─── */}
        {(stage === "unlocked" || stage === "running" || stage === "seeding" || stage === "error" || stage === "done" || stage === "seeded") && (
          <div className="space-y-3">

            {/* Error banner */}
            {stage === "error" && (
              <div className="rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-300">
                {errorMsg}
              </div>
            )}

            {/* Unlocked / no weights warning */}
            {stage === "unlocked" && errorMsg && (
              <div className="rounded-xl bg-yellow-500/10 border border-yellow-500/20 px-4 py-3 text-sm text-yellow-300">
                {errorMsg}
              </div>
            )}

            {/* ── FedAvg card ───────────────────────────────────────────── */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <div>
                <p className="font-medium text-sm">FedAvg — aggregate client weights</p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Averages the latest weights from all users and pushes the result to the model service.
                </p>
              </div>

              {stage === "running" ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span className="w-4 h-4 border-2 border-zinc-600 border-t-violet-400 rounded-full animate-spin" />
                  Running FedAvg…
                </div>
              ) : (
                <button onClick={handleTrain}
                  className="w-full py-2.5 bg-violet-600 hover:bg-violet-500 rounded-lg text-sm font-semibold transition-colors">
                  Run FedAvg round
                </button>
              )}

              {stage === "done" && fedAvgResult && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800 text-sm">
                  <div><p className="text-xs text-zinc-500">Participants</p><p className="font-semibold">{fedAvgResult.participants}</p></div>
                  <div><p className="text-xs text-zinc-500">Global model #</p><p className="font-semibold">{fedAvgResult.globalModel.serialno}</p></div>
                  <div className="col-span-2"><p className="text-xs text-zinc-500">Saved at</p>
                    <p className="font-semibold text-xs">{new Date(fedAvgResult.globalModel.timestamp).toLocaleString()}</p></div>
                  <div className="col-span-2"><p className="text-xs text-zinc-500">Model service</p>
                    <p className={`font-semibold text-xs ${fedAvgResult.modelService === "weights updated" ? "text-emerald-400" : "text-yellow-400"}`}>
                      {fedAvgResult.modelService}</p></div>
                </div>
              )}
            </div>

            {/* ── Seed from dataset card ────────────────────────────────── */}
            <div className="bg-zinc-900/80 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <div>
                <p className="font-medium text-sm">Seed — train on <span className="font-mono text-violet-300">demo-dataset.csv</span></p>
                <p className="text-xs text-zinc-500 mt-0.5">
                  Trains the sklearn model on the 30,000-row synthetic demonstration dataset and reports a reproducible hold-out evaluation. It is for the paper/demo only.
                </p>
              </div>

              {stage === "seeding" ? (
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                  <span className="w-4 h-4 border-2 border-zinc-600 border-t-emerald-400 rounded-full animate-spin" />
                  Training on dataset…
                </div>
              ) : (
                <button onClick={handleSeed}
                  className="w-full py-2.5 bg-emerald-700 hover:bg-emerald-600 rounded-lg text-sm font-semibold transition-colors">
                  Seed from demo-dataset.csv
                </button>
              )}

              {stage === "seeded" && seedResult && (
                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800 text-sm">
                  <div><p className="text-xs text-zinc-500">Samples</p><p className="font-semibold">{seedResult.n_samples}</p></div>
                  <div><p className="text-xs text-zinc-500">Features</p><p className="font-semibold">{seedResult.n_features}</p></div>
                  <div><p className="text-xs text-zinc-500">Classes</p><p className="font-semibold">{seedResult.classes.join(", ")}</p></div>
                  <div><p className="text-xs text-zinc-500">Global model #</p><p className="font-semibold">{seedResult.globalModel.serialno}</p></div>
                  <div className="col-span-2"><p className="text-xs text-zinc-500">Saved at</p>
                    <p className="font-semibold text-xs">{new Date(seedResult.globalModel.timestamp).toLocaleString()}</p></div>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-zinc-700">
          This page is not linked from anywhere. Keep the URL and secret private.
        </p>
      </div>
    </div>
  );
}
