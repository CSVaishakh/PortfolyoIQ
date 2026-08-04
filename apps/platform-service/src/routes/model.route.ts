import { Router, Request, Response } from "express";
import { getAllLatestUserWeights, saveGlobalWeights } from "../queries/client.queries.js";

const modelRouter = Router();

const MODEL_SERVICE_URL = process.env["MODEL_SERVICE_URL"] ?? "http://localhost:8000";
const ADMIN_SECRET      = process.env["ADMIN_SECRET"];
if (!ADMIN_SECRET) throw new Error("ADMIN_SECRET env variable is not set");

/** Fewest distinct participants required before an aggregation round runs. */
const MIN_PARTICIPANTS = 2;

/** Linear-model row shape contract shared with the client (12 standardized features). */
const N_FEATURES = 12;

function requireAdminSecret(req: Request, res: Response): boolean {
  const provided = req.headers["x-admin-secret"];
  if (provided !== ADMIN_SECRET) {
    res.status(403).json({ error: "Invalid admin secret." });
    return false;
  }
  return true;
}

// ── FedAvg helpers ────────────────────────────────────────────────────────────

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** True if the row is a well-formed, finite linear-model snapshot. */
function isValidWeightRow(row: {
  coeff: unknown;
  intercept: unknown;
  n_samples: unknown;
}): boolean {
  if (!Array.isArray(row.coeff) || row.coeff.length !== 1) return false;
  const coeffRow = row.coeff[0];
  if (!Array.isArray(coeffRow) || coeffRow.length !== N_FEATURES) return false;
  if (!Array.isArray(row.intercept) || row.intercept.length < 1) return false;
  if (coeffRow.some((v) => !isFiniteNumber(v))) return false;
  if (row.intercept.some((v) => !isFiniteNumber(v))) return false;
  if (!isFiniteNumber(row.n_samples) || row.n_samples <= 0) return false;
  return true;
}

/**
 * Sample-weighted mean of participant matrices: W̄ = Σ (nᵢ/Σn) · Mᵢ.
 * Every participant's rows are guaranteed to share the same shape (validated
 * upstream), so no shape mismatch can occur at reduction time.
 */
function avgMatrix(matrices: number[][][], weights: number[]): number[][] {
  const rows = matrices[0].length;
  const cols = matrices[0][0].length;
  const total = weights.reduce((a, b) => a + b, 0);

  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) =>
      matrices.reduce((sum, m, k) => sum + (weights[k] / total) * m[i][j], 0)
    )
  );
}

function avgVector(vectors: number[][], weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const len = vectors[0].length;

  return Array.from({ length: len }, (_, i) =>
    vectors.reduce((sum, v, k) => sum + (weights[k] / total) * v[i], 0)
  );
}

export interface FedAvgResult {
  participants: number;
  serialno: number;
  coeff: number[][];
  intercept: number[];
  n_samples_total: number;
  timestamp: string | Date;
  modelService: string;
}

// ── Exported aggregation entry point (admin routes only) ─────────────────────
// Aggregation is deliberately NOT triggered from the client upload path:
// fire-and-forget runs on every upload caused racing, interleaved rounds.

export async function runFedAvg(): Promise<FedAvgResult | null> {
  const rows = await getAllLatestUserWeights();

  const valid = rows.filter((r) => isValidWeightRow(r));
  if (valid.length < MIN_PARTICIPANTS) return null;

  const coeffs    = valid.map((r) => r.coeff     as number[][]);
  const intercept = valid.map((r) => r.intercept as number[]);
  const samples   = valid.map((r) => r.n_samples  as number);

  // Sample-weighted FedAvg — a participant who trained on 190 rows moves the
  // global model ~190x more than one who trained on a single row.
  const aggregatedCoeff     = avgMatrix(coeffs, samples);
  const aggregatedIntercept = avgVector(intercept, samples);
  const nSamplesTotal       = samples.reduce((a, b) => a + b, 0);

  // Persist aggregated weights to globalModelHistory
  const global = await saveGlobalWeights(aggregatedCoeff, aggregatedIntercept);

  // Push aggregated weights to the model-service
  let modelService = "unreachable";
  try {
    const msRes = await fetch(`${MODEL_SERVICE_URL}/weights`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ coeff: aggregatedCoeff, intercept: aggregatedIntercept }),
    });
    modelService = msRes.ok ? "weights updated" : `rejected (HTTP ${msRes.status})`;
  } catch (err) {
    modelService = `unreachable — ${(err as Error).message}`;
  }

  return {
    participants: valid.length,
    serialno: global.serialno,
    coeff: aggregatedCoeff,
    intercept: aggregatedIntercept,
    n_samples_total: nSamplesTotal,
    timestamp: global.timestamp,
    modelService,
  };
}

// ── POST /model/aggregate ─────────────────────────────────────────────────────
// Manually trigger a FedAvg round. Can also be called internally.

modelRouter.post("/aggregate", async (_req, res: Response) => {
  const result = await runFedAvg();

  if (!result) {
    res.status(400).json({
      error: `Fewer than ${MIN_PARTICIPANTS} valid participants available for aggregation.`,
    });
    return;
  }

  res.json({
    participants: result.participants,
    n_samples_total: result.n_samples_total,
    globalModel: {
      serialno:  result.serialno,
      coeff:     result.coeff,
      intercept: result.intercept,
    },
    modelService: result.modelService,
  });
});

// ── POST /model/seed ──────────────────────────────────────────────────────────
// Admin-only. Trains the model-service directly on the bundled dataset.csv,
// then saves the resulting weights to globalModelHistory so clients can
// warm-start from them.
// Requires header:  x-admin-secret: <ADMIN_SECRET>

modelRouter.post("/seed", async (req: Request, res: Response) => {
  if (!requireAdminSecret(req, res)) return;

  let msData: {
    n_samples: number;
    n_features: number;
    classes: number[];
    coeff: number[][];
    intercept: number[];
    message: string;
  };

  try {
    const msRes = await fetch(`${MODEL_SERVICE_URL}/train/dataset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!msRes.ok) {
      const body = await msRes.json().catch(() => ({})) as { detail?: string };
      res.status(502).json({ error: `Model service error: ${body.detail ?? msRes.status}` });
      return;
    }

    msData = await msRes.json();
  } catch (err) {
    res.status(502).json({ error: `Could not reach model service: ${(err as Error).message}` });
    return;
  }

  // Persist the freshly trained weights as a new global model snapshot
  const global = await saveGlobalWeights(msData.coeff, msData.intercept);

  res.json({
    message:    msData.message,
    n_samples:  msData.n_samples,
    n_features: msData.n_features,
    classes:    msData.classes,
    globalModel: {
      serialno:  global.serialno,
      timestamp: global.timestamp,
    },
  });
});

// ── POST /model/train ─────────────────────────────────────────────────────────
// Admin-only. Runs sample-weighted FedAvg over all stored user weights, updates
// the global model in the DB, and pushes the aggregated weights to the
// model-service.
// Requires header:  x-admin-secret: <ADMIN_SECRET>

modelRouter.post("/train", async (req: Request, res: Response) => {
  if (!requireAdminSecret(req, res)) return;

  const result = await runFedAvg();

  if (!result) {
    res.status(400).json({
      error: `Fewer than ${MIN_PARTICIPANTS} valid participants with weights available yet. Have clients run predictions first.`,
    });
    return;
  }

  res.status(result.modelService === "weights updated" ? 200 : 207).json({
    participants:    result.participants,
    n_samples_total: result.n_samples_total,
    globalModel: {
      serialno:  result.serialno,
      timestamp: result.timestamp,
    },
    modelService: result.modelService,
  });
});

export { modelRouter };