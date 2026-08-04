import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware.js";
import {
  getUserById,
  getLatestGlobalModel,
  getLatestUserWeights,
  saveUserWeights,
  getUserModelHistory,
} from "../queries/client.queries.js";

/** Width of the standardized 12-feature vector every client model must match. */
const N_FEATURES = 12;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Validate an uploaded linear-model payload.
 * Rejects malformed shapes, wrong feature widths and non-finite values — a single
 * malformed upload would otherwise poison the aggregated (mean) model.
 */
function validateWeightsPayload(
  coef: unknown,
  intercept: unknown
): { ok: true; coef: number[][]; intercept: number[] } | { ok: false; error: string } {
  if (!Array.isArray(coef) || coef.length !== 1) {
    return { ok: false, error: "coef must be a 1×N matrix" };
  }
  if (!Array.isArray(coef[0]) || coef[0].length !== N_FEATURES) {
    return { ok: false, error: `coef must have exactly ${N_FEATURES} features` };
  }
  if (!Array.isArray(intercept) || intercept.length < 1) {
    return { ok: false, error: "intercept must be a non-empty vector" };
  }
  if (coef[0].some((v) => !isFiniteNumber(v))) {
    return { ok: false, error: "coef contains a non-finite value" };
  }
  if (intercept.some((v) => !isFiniteNumber(v))) {
    return { ok: false, error: "intercept contains a non-finite value" };
  }
  return { ok: true, coef: coef as number[][], intercept: intercept as number[] };
}

const clientRouter = Router();

// All client routes require a valid JWT
clientRouter.use(authMiddleware);

// ── GET /client/profile ────────────────────────────────────────────────────
// Returns the authenticated user's public profile (no password).
clientRouter.get("/profile", async (req, res: Response) => {
  const userId = (req as AuthRequest).userId;

  const user = await getUserById(userId);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  res.json({ user });
});

// ── GET /client/model/global ───────────────────────────────────────────────
// Returns the latest global model weights from globalModelHistory.
// The client calls this on app load to warm-start its local TF.js model via
// model.setWeights(coef, intercept).
clientRouter.get("/model/global", async (_req, res: Response) => {
  const row = await getLatestGlobalModel();
  if (!row) {
    res.status(404).json({ error: "No global model available yet" });
    return;
  }

  res.json({
    serialno:  row.serialno,
    coef:      row.coeff,
    intercept: row.intercept,
    timestamp: row.timestamp,
  });
});

// ── GET /client/model/weights ──────────────────────────────────────────────
// Returns the authenticated user's most recent locally-trained weights.
// Used to resume a session without retraining.
clientRouter.get("/model/weights", async (req, res: Response) => {
  const userId = (req as AuthRequest).userId;

  const row = await getLatestUserWeights(userId);
  if (!row) {
    res.status(404).json({ error: "No weights found for this user" });
    return;
  }

  res.json({
    serialno:  row.serialno,
    coef:      row.coeff,
    intercept: row.intercept,
    timestamp: row.timestamp,
  });
});

// ── POST /client/model/weights ─────────────────────────────────────────────
// Submits locally-fine-tuned weights after a client-side fit() call.
// Persists a new row in userModelHistory.
// Body: { coef: number[][], intercept: number[], n_samples: number }
// n_samples is the real number of rows the client trained on; it weights the
// client's contribution in the sample-weighted FedAvg aggregation step.
// Aggregation itself is admin-triggered (POST /model/train) — NOT run
// fire-and-forget here, so a stampede of uploads cannot trigger concurrent,
// racing aggregation rounds.
clientRouter.post("/model/weights", async (req, res: Response) => {
  const userId = (req as AuthRequest).userId;

  const { coef, intercept, n_samples } = req.body as {
    coef?: unknown;
    intercept?: unknown;
    n_samples?: unknown;
  };

  if (coef === undefined || intercept === undefined || n_samples === undefined) {
    res.status(400).json({ error: "coef, intercept, and n_samples are required" });
    return;
  }

  if (!isFiniteNumber(n_samples) || n_samples <= 0 || n_samples > 1_000_000) {
    res.status(400).json({ error: "n_samples must be a positive finite number" });
    return;
  }

  const validated = validateWeightsPayload(coef, intercept);
  if (!validated.ok) {
    res.status(400).json({ error: validated.error });
    return;
  }

  let row;
  try {
    row = await saveUserWeights(userId, validated.coef, validated.intercept, n_samples);
  } catch (err) {
    const msg = (err as Error).message ?? String(err);
    // FK violation means the JWT references a user that no longer exists (DB was reset)
    const isStaleToken = msg.includes("foreign key") || msg.includes("violates");
    console.error("[weights] saveUserWeights failed:", msg);
    res.status(isStaleToken ? 401 : 500).json({
      error: isStaleToken
        ? "Session is stale — your account no longer exists. Please sign out and sign up again."
        : "Failed to save weights.",
    });
    return;
  }

  res.status(201).json({
    serialno:  row.serialno,
    coef:      row.coeff,
    intercept: row.intercept,
    n_samples: row.n_samples,
    timestamp: row.timestamp,
  });
});

// ── GET /client/model/history ──────────────────────────────────────────────
// Paginated list of the user's model snapshots, newest first.
// Query params: page (default 1), limit (default 10, max 50)
clientRouter.get("/model/history", async (req, res: Response) => {
  const userId = (req as AuthRequest).userId;

  const page  = Math.max(1, parseInt(req.query["page"]  as string) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query["limit"] as string) || 10));
  const offset = (page - 1) * limit;

  const rows = await getUserModelHistory(userId, limit, offset);

  res.json({
    page,
    limit,
    results: rows.map(r => ({
      serialno:  r.serialno,
      coef:      r.coeff,
      intercept: r.intercept,
      timestamp: r.timestamp,
    })),
  });
});

export { clientRouter };
