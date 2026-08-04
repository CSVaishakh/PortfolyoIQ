import { Router, Response } from "express";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware.js";
import {
  getUserById,
  getLatestGlobalModel,
  getLatestUserWeights,
  saveUserWeights,
  getUserModelHistory,
} from "../queries/client.queries.js";
import { checkContributionRate, MIN_UPLOAD_INTERVAL_MS, validateUpload } from "../weight-validation.js";

/**
 * Database collaborators the client routes need. Injected so the HTTP contract
 * — auth, validation, status codes, throttling — can be tested without a
 * PostgreSQL instance.
 */
export interface ClientRouterDeps {
  getUserById: typeof getUserById;
  getLatestGlobalModel: typeof getLatestGlobalModel;
  getLatestUserWeights: typeof getLatestUserWeights;
  saveUserWeights: typeof saveUserWeights;
  getUserModelHistory: typeof getUserModelHistory;
}

export interface ClientRouterConfig {
  federatedContributionsEnabled: boolean;
  outcomeBasedModelEnabled: boolean;
  demoModelEnabled: boolean;
  uploadIntervalMs: number;
}

export function clientRouterConfigFromEnv(): ClientRouterConfig {
  return {
    federatedContributionsEnabled: process.env["FEDERATED_CONTRIBUTIONS_ENABLED"] === "true",
    outcomeBasedModelEnabled: process.env["OUTCOME_BASED_MODEL_ENABLED"] === "true",
    demoModelEnabled: process.env["DEMO_MODEL_ENABLED"] === "true",
    uploadIntervalMs: MIN_UPLOAD_INTERVAL_MS,
  };
}

export function createClientRouter(deps: ClientRouterDeps, config: ClientRouterConfig): Router {
  const clientRouter = Router();

  /** Last accepted contribution per account, used for the per-account throttle. */
  const lastContributionAt = new Map<number, number>();

  // All client routes require a valid JWT
  clientRouter.use(authMiddleware);

  // ── GET /client/profile ────────────────────────────────────────────────────
  // Returns the authenticated user's public profile (no password).
  clientRouter.get("/profile", async (req, res: Response) => {
    const userId = (req as AuthRequest).userId;

    const user = await deps.getUserById(userId);
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
    if (!config.outcomeBasedModelEnabled && !config.demoModelEnabled) {
      res.status(503).json({ error: "The secondary ML model is paused pending outcome-based validation." });
      return;
    }
    const row = await deps.getLatestGlobalModel();
    if (!row) {
      res.status(404).json({ error: "No global model available yet" });
      return;
    }

    res.json({
      serialno: row.serialno,
      coef: row.coeff,
      intercept: row.intercept,
      timestamp: row.timestamp,
      feature_version: row.feature_version,
      scaler_version: row.scaler_version,
      model_version: row.model_version,
      demo: config.demoModelEnabled,
    });
  });

  // ── GET /client/model/weights ──────────────────────────────────────────────
  // Returns the authenticated user's most recent locally-trained weights.
  // Used to resume a session without retraining.
  clientRouter.get("/model/weights", async (req, res: Response) => {
    const userId = (req as AuthRequest).userId;

    const row = await deps.getLatestUserWeights(userId);
    if (!row) {
      res.status(404).json({ error: "No weights found for this user" });
      return;
    }

    res.json({
      serialno: row.serialno,
      coef: row.coeff,
      intercept: row.intercept,
      timestamp: row.timestamp,
      feature_version: row.feature_version,
      scaler_version: row.scaler_version,
      model_version: row.model_version,
    });
  });

  // ── POST /client/model/weights ─────────────────────────────────────────────
  // Submits locally-fine-tuned weights after a client-side fit() call.
  // Persists a new row in userModelHistory.
  // Body: { coef, intercept, n_samples, feature_version, scaler_version, model_version }
  // n_samples is the real number of rows the client trained on; it weights the
  // client's contribution in the sample-weighted FedAvg aggregation step.
  // Aggregation itself is admin-triggered (POST /model/train) — NOT run
  // fire-and-forget here, so a stampede of uploads cannot trigger concurrent,
  // racing aggregation rounds.
  clientRouter.post("/model/weights", async (req, res: Response) => {
    if (!config.federatedContributionsEnabled) {
      res.status(503).json({
        error: "Federated contributions are paused until the outcome-based model pipeline is enabled.",
      });
      return;
    }
    const userId = (req as AuthRequest).userId;

    // Throttle the contribution itself. Rate limiting anything else would leave
    // the only state-changing federated route unlimited.
    const throttled = checkContributionRate(lastContributionAt.get(userId), Date.now(), config.uploadIntervalMs);
    if (throttled) {
      res.status(throttled.status).json({ error: throttled.error });
      return;
    }

    const validation = validateUpload((req.body ?? {}) as Record<string, unknown>);
    if (!validation.ok) {
      const { status, error, expected } = validation.rejection;
      res.status(status).json(expected ? { error, expected } : { error });
      return;
    }
    const upload = validation.value;

    let row;
    try {
      row = await deps.saveUserWeights(
        userId,
        upload.coef,
        upload.intercept,
        upload.n_samples,
        upload.feature_version,
        upload.scaler_version,
        upload.model_version,
        upload.validation_auc,
      );
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

    lastContributionAt.set(userId, Date.now());
    res.status(201).json({
      serialno: row.serialno,
      coef: row.coeff,
      intercept: row.intercept,
      n_samples: row.n_samples,
      feature_version: row.feature_version,
      scaler_version: row.scaler_version,
      model_version: row.model_version,
      timestamp: row.timestamp,
    });
  });

  // ── GET /client/model/history ──────────────────────────────────────────────
  // Paginated list of the user's model snapshots, newest first.
  // Query params: page (default 1), limit (default 10, max 50)
  clientRouter.get("/model/history", async (req, res: Response) => {
    const userId = (req as AuthRequest).userId;

    const page = Math.max(1, parseInt(req.query["page"] as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query["limit"] as string) || 10));
    const offset = (page - 1) * limit;

    const rows = await deps.getUserModelHistory(userId, limit, offset);

    res.json({
      page,
      limit,
      results: rows.map((r) => ({
        serialno: r.serialno,
        coef: r.coeff,
        intercept: r.intercept,
        timestamp: r.timestamp,
        feature_version: r.feature_version,
        scaler_version: r.scaler_version,
        model_version: r.model_version,
      })),
    });
  });

  return clientRouter;
}

const clientRouter = createClientRouter(
  { getUserById, getLatestGlobalModel, getLatestUserWeights, saveUserWeights, getUserModelHistory },
  clientRouterConfigFromEnv(),
);

export { clientRouter };
