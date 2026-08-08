import { Router, Request, Response } from "express";
import {
  getAllLatestUserWeights,
  getGlobalModelBySerial,
  getLatestGlobalModel,
  saveGlobalWeights,
} from "../queries/client.queries.js";
import { MODEL_CONTRACT } from "../model-contract.js";
import {
  AggregationRoundInProgressError,
  MIN_PARTICIPANTS,
  ModelServiceUnavailableError,
  runAggregationRound,
  type AggregationDeps,
  type AggregationResult,
  type LinearModel,
} from "../federated.js";

export interface SeedTrainingResponse {
  n_samples: number;
  n_features: number;
  classes: number[];
  coeff: number[][];
  intercept: number[];
  message: string;
}

/**
 * Outbound calls the model routes make. Injected so aggregation, rollback and
 * seeding can be tested against a stub model service.
 */
export interface ModelServiceClient {
  pushWeights: (model: LinearModel) => Promise<void>;
  trainOnDataset: () => Promise<SeedTrainingResponse>;
}

export interface ModelRouterDeps {
  getAllLatestUserWeights: typeof getAllLatestUserWeights;
  getLatestGlobalModel: typeof getLatestGlobalModel;
  getGlobalModelBySerial: typeof getGlobalModelBySerial;
  saveGlobalWeights: typeof saveGlobalWeights;
  modelService: ModelServiceClient;
}

export interface ModelRouterConfig {
  adminSecret: string;
  federatedAggregationEnabled: boolean;
  demoModelEnabled: boolean;
}

export function modelRouterConfigFromEnv(): ModelRouterConfig {
  const adminSecret = process.env["ADMIN_SECRET"];
  if (!adminSecret) throw new Error("ADMIN_SECRET env variable is not set");
  return {
    adminSecret,
    federatedAggregationEnabled: process.env["FEDERATED_AGGREGATION_ENABLED"] === "true",
    demoModelEnabled: process.env["DEMO_MODEL_ENABLED"] === "true",
  };
}

/** HTTP model-service client built from the environment's internal secret. */
export function createHttpModelServiceClient(): ModelServiceClient {
  const modelServiceUrl = process.env["MODEL_SERVICE_URL"] ?? "http://localhost:8000";
  const modelServiceSecret = process.env["MODEL_SERVICE_SECRET"];
  if (!modelServiceSecret) throw new Error("MODEL_SERVICE_SECRET env variable is not set");

  const headers = {
    "Content-Type": "application/json",
    "x-model-service-secret": modelServiceSecret,
  };

  return {
    async pushWeights(model: LinearModel): Promise<void> {
      const response = await fetch(`${modelServiceUrl}/weights`, {
        method: "POST",
        headers,
        body: JSON.stringify({ coeff: model.coeff, intercept: model.intercept }),
      });
      if (!response.ok) throw new Error(`model service rejected the weights (HTTP ${response.status})`);
    },
    async trainOnDataset(): Promise<SeedTrainingResponse> {
      const response = await fetch(`${modelServiceUrl}/train/dataset`, { method: "POST", headers });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { detail?: string };
        throw new Error(`Model service error: ${body.detail ?? response.status}`);
      }
      return await response.json() as SeedTrainingResponse;
    },
  };
}

export function createModelRouter(deps: ModelRouterDeps, config: ModelRouterConfig): Router {
  const modelRouter: Router = Router();

  function requireAdminSecret(req: Request, res: Response): boolean {
    const provided = req.headers["x-admin-secret"];
    if (provided !== config.adminSecret) {
      res.status(403).json({ error: "Invalid admin secret." });
      return false;
    }
    return true;
  }

  const aggregationDeps: AggregationDeps = {
    loadLatestUserWeights: () => deps.getAllLatestUserWeights(),
    async loadActiveGlobalModel() {
      const active = await deps.getLatestGlobalModel();
      return active ? { coeff: active.coeff as number[][], intercept: active.intercept as number[] } : null;
    },
    async saveGlobalModel(model, participants, nSamplesTotal) {
      return deps.saveGlobalWeights(
        model.coeff,
        model.intercept,
        participants,
        nSamplesTotal,
        MODEL_CONTRACT.featureVersion,
        MODEL_CONTRACT.scalerVersion,
        MODEL_CONTRACT.modelVersion,
      );
    },
    pushToModelService: (model) => deps.modelService.pushWeights(model),
  };

  /**
   * Shared handler for the two admin aggregation routes. Translates the round's
   * outcomes into stable status codes: 409 for a concurrent round, 502 when the
   * model service never confirmed (in which case nothing was activated).
   */
  async function handleAggregation(
    req: Request,
    res: Response,
    onSuccess: (result: AggregationResult) => void,
    tooFewMessage: string,
  ): Promise<void> {
    if (!requireAdminSecret(req, res)) return;
    if (!config.federatedAggregationEnabled) {
      res.status(503).json({ error: "Federated aggregation is paused pending outcome-based model validation." });
      return;
    }

    let result: AggregationResult | null;
    try {
      result = await runAggregationRound(aggregationDeps);
    } catch (err) {
      if (err instanceof AggregationRoundInProgressError) {
        res.status(409).json({ error: err.message });
        return;
      }
      if (err instanceof ModelServiceUnavailableError) {
        res.status(502).json({ error: err.message, activated: false });
        return;
      }
      throw err;
    }

    if (!result) {
      res.status(400).json({ error: tooFewMessage });
      return;
    }
    onSuccess(result);
  }

  // ── POST /model/aggregate ───────────────────────────────────────────────────
  // Admin-only. Runs one sample-weighted FedAvg round.
  // Requires header:  x-admin-secret: <ADMIN_SECRET>
  modelRouter.post("/aggregate", async (req: Request, res: Response) => {
    await handleAggregation(
      req,
      res,
      (result) => {
        res.json({
          participants: result.participants,
          n_samples_total: result.n_samples_total,
          globalModel: {
            serialno: result.serialno,
            coeff: result.coeff,
            intercept: result.intercept,
          },
          modelService: result.modelService,
        });
      },
      `Fewer than ${MIN_PARTICIPANTS} valid participants available for aggregation.`,
    );
  });

  // ── POST /model/train ───────────────────────────────────────────────────────
  // Admin-only. Same round as /aggregate, with a summary response.
  modelRouter.post("/train", async (req: Request, res: Response) => {
    await handleAggregation(
      req,
      res,
      (result) => {
        res.status(200).json({
          participants: result.participants,
          n_samples_total: result.n_samples_total,
          globalModel: {
            serialno: result.serialno,
            timestamp: result.timestamp,
          },
          modelService: result.modelService,
        });
      },
      `Fewer than ${MIN_PARTICIPANTS} valid participants with weights available yet. Have clients run predictions first.`,
    );
  });

  // ── POST /model/seed ────────────────────────────────────────────────────────
  // Admin-only. Trains the model-service directly on the bundled demo dataset,
  // then saves the resulting weights to globalModelHistory so clients can
  // warm-start from them.
  // Requires header:  x-admin-secret: <ADMIN_SECRET>
  modelRouter.post("/seed", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    if (!config.federatedAggregationEnabled && !config.demoModelEnabled) {
      res.status(503).json({ error: "Model seeding is paused pending outcome-based model validation." });
      return;
    }

    let msData: SeedTrainingResponse;
    try {
      msData = await deps.modelService.trainOnDataset();
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
      return;
    }

    // Persist the freshly trained weights as a new global model snapshot.
    const global = await deps.saveGlobalWeights(
      msData.coeff,
      msData.intercept,
      0,
      msData.n_samples,
      MODEL_CONTRACT.featureVersion,
      MODEL_CONTRACT.scalerVersion,
      MODEL_CONTRACT.modelVersion,
    );

    res.json({
      message: msData.message,
      n_samples: msData.n_samples,
      n_features: msData.n_features,
      classes: msData.classes,
      globalModel: {
        serialno: global.serialno,
        timestamp: global.timestamp,
      },
    });
  });

  // ── POST /model/rollback/:serialno ──────────────────────────────────────────
  // Operator rollback: restores a recorded global snapshot by creating a new
  // snapshot, leaving the original history intact for the audit trail. As with
  // aggregation, the model service must confirm before the restore is recorded.
  modelRouter.post("/rollback/:serialno", async (req: Request, res: Response) => {
    if (!requireAdminSecret(req, res)) return;
    const serialno = Number(req.params["serialno"]);
    if (!Number.isInteger(serialno) || serialno < 1) {
      res.status(400).json({ error: "serialno must be a positive integer" });
      return;
    }
    const previous = await deps.getGlobalModelBySerial(serialno);
    if (!previous) {
      res.status(404).json({ error: "Model snapshot not found" });
      return;
    }
    try {
      await deps.modelService.pushWeights({
        coeff: previous.coeff as number[][],
        intercept: previous.intercept as number[],
      });
    } catch (err) {
      res.status(502).json({ error: `Could not roll back: ${(err as Error).message}`, activated: false });
      return;
    }
    const restored = await deps.saveGlobalWeights(
      previous.coeff as number[][],
      previous.intercept as number[],
      0,
      0,
      previous.feature_version,
      previous.scaler_version,
      previous.model_version,
    );
    res.json({
      message: `Restored snapshot ${serialno}`,
      globalModel: { serialno: restored.serialno, timestamp: restored.timestamp },
    });
  });

  return modelRouter;
}

const modelRouter = createModelRouter(
  {
    getAllLatestUserWeights,
    getLatestGlobalModel,
    getGlobalModelBySerial,
    saveGlobalWeights,
    modelService: createHttpModelServiceClient(),
  },
  modelRouterConfigFromEnv(),
);

export { modelRouter };
