/**
 * Federated aggregation core.
 *
 * Everything here is deliberately free of Express, environment variables and
 * database imports so an aggregation round can be exercised end-to-end in a
 * unit test with substituted collaborators. `model.route.ts` supplies the real
 * database queries and the model-service HTTP call.
 */

import { hasCurrentModelContract, MODEL_CONTRACT } from "./model-contract.js";

/** Width of the standardized feature vector every stored coefficient row must match. */
export const N_FEATURES = 12;

/** Fewest distinct participants required before an aggregation round runs. */
export const MIN_PARTICIPANTS = 2;

/**
 * Largest L2 distance a single participant may move the active model. Without a
 * cap, one account can drag the mean anywhere it likes, so this is the influence
 * limit that makes a small Sybil set unprofitable.
 */
export const MAX_UPDATE_L2_NORM = 5;

/** Attempts made to hand the aggregated weights to the model service. */
export const MODEL_SERVICE_PUSH_ATTEMPTS = 3;

export interface WeightRow {
  coeff: unknown;
  intercept: unknown;
  n_samples: unknown;
  feature_version: unknown;
  scaler_version: unknown;
  model_version: unknown;
}

export interface LinearModel {
  coeff: number[][];
  intercept: number[];
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * True if the row is a well-formed, finite, contract-current linear-model
 * snapshot. A single malformed row would otherwise poison a mean.
 */
export function isValidWeightRow(row: WeightRow): boolean {
  if (!Array.isArray(row.coeff) || row.coeff.length !== 1) return false;
  const coeffRow = row.coeff[0];
  if (!Array.isArray(coeffRow) || coeffRow.length !== N_FEATURES) return false;
  if (!Array.isArray(row.intercept) || row.intercept.length !== 1) return false;
  if (coeffRow.some((v) => !isFiniteNumber(v))) return false;
  if (row.intercept.some((v) => !isFiniteNumber(v))) return false;
  if (!isFiniteNumber(row.n_samples) || row.n_samples <= 0) return false;
  if (
    !isFiniteNumber(row.feature_version) || !isFiniteNumber(row.scaler_version)
    || !isFiniteNumber(row.model_version)
    || !Number.isInteger(row.feature_version) || !Number.isInteger(row.scaler_version)
    || !Number.isInteger(row.model_version)
    || !hasCurrentModelContract({
      feature_version: row.feature_version,
      scaler_version: row.scaler_version,
      model_version: row.model_version,
    })
  ) return false;
  return true;
}

/**
 * Sample-weighted mean of participant matrices: W̄ = Σ (nᵢ/Σn) · Mᵢ.
 * Every participant's rows are guaranteed to share the same shape (validated
 * upstream), so no shape mismatch can occur at reduction time.
 */
export function avgMatrix(matrices: number[][][], weights: number[]): number[][] {
  const rows = matrices[0]!.length;
  const cols = matrices[0]![0]!.length;
  const total = weights.reduce((a, b) => a + b, 0);

  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) =>
      matrices.reduce((sum, m, k) => sum + (weights[k]! / total) * m[i]![j]!, 0)
    )
  );
}

export function avgVector(vectors: number[][], weights: number[]): number[] {
  const total = weights.reduce((a, b) => a + b, 0);
  const len = vectors[0]!.length;

  return Array.from({ length: len }, (_, i) =>
    vectors.reduce((sum, v, k) => sum + (weights[k]! / total) * v[i]!, 0)
  );
}

/**
 * Scale a participant's delta from the active model back to `MAX_UPDATE_L2_NORM`
 * when it exceeds the cap. Direction is preserved; only magnitude is limited.
 */
export function clipUpdate(
  coeff: number[][],
  intercept: number[],
  baseCoeff: number[][],
  baseIntercept: number[],
): LinearModel {
  const delta = [
    ...coeff[0]!.map((value, index) => value - baseCoeff[0]![index]!),
    intercept[0]! - baseIntercept[0]!,
  ];
  const norm = Math.sqrt(delta.reduce((sum, value) => sum + value ** 2, 0));
  if (norm <= MAX_UPDATE_L2_NORM) return { coeff, intercept };
  const scale = MAX_UPDATE_L2_NORM / norm;
  return {
    coeff: [coeff[0]!.map((value, index) => baseCoeff[0]![index]! + (value - baseCoeff[0]![index]!) * scale)],
    intercept: [baseIntercept[0]! + (intercept[0]! - baseIntercept[0]!) * scale],
  };
}

/**
 * Deterministic clip-then-average reduction over already-validated rows.
 * Pure: the same inputs always produce the same aggregate.
 */
export function aggregateWeights(
  rows: WeightRow[],
  base: LinearModel,
): { coeff: number[][]; intercept: number[]; nSamplesTotal: number; participants: number } {
  const clipped = rows.map((r) =>
    clipUpdate(r.coeff as number[][], r.intercept as number[], base.coeff, base.intercept)
  );
  const samples = rows.map((r) => r.n_samples as number);

  return {
    // Sample-weighted FedAvg — a participant who trained on 190 rows moves the
    // global model ~190x more than one who trained on a single row.
    coeff: avgMatrix(clipped.map((c) => c.coeff), samples),
    intercept: avgVector(clipped.map((c) => c.intercept), samples),
    nSamplesTotal: samples.reduce((a, b) => a + b, 0),
    participants: rows.length,
  };
}

// ── Round orchestration ──────────────────────────────────────────────────────

export interface SavedGlobalModel {
  serialno: number;
  timestamp: string | Date | null;
}

export interface AggregationDeps {
  loadLatestUserWeights: () => Promise<WeightRow[]>;
  loadActiveGlobalModel: () => Promise<LinearModel | null>;
  /** Persist the aggregate. Only called after the model service has confirmed it. */
  saveGlobalModel: (
    model: LinearModel,
    participants: number,
    nSamplesTotal: number,
  ) => Promise<SavedGlobalModel>;
  /** Resolves when the model service has accepted the weights; rejects otherwise. */
  pushToModelService: (model: LinearModel) => Promise<void>;
}

export interface AggregationResult {
  participants: number;
  serialno: number;
  coeff: number[][];
  intercept: number[];
  n_samples_total: number;
  timestamp: string | Date | null;
  modelService: string;
  pushAttempts: number;
}

export class AggregationRoundInProgressError extends Error {
  constructor() {
    super("An aggregation round is already running");
    this.name = "AggregationRoundInProgressError";
  }
}

export class ModelServiceUnavailableError extends Error {
  readonly attempts: number;
  constructor(attempts: number, cause: unknown) {
    super(`Model service did not accept the aggregated weights after ${attempts} attempts: ${(cause as Error)?.message ?? String(cause)}`);
    this.name = "ModelServiceUnavailableError";
    this.attempts = attempts;
  }
}

/**
 * Serializes aggregation. A second caller is rejected rather than queued: two
 * interleaved rounds would each read the same participant set and write two
 * competing "latest" snapshots.
 */
let roundInProgress = false;

/** Test-only reset so a failed round in one case cannot leak into the next. */
export function resetAggregationLock(): void {
  roundInProgress = false;
}

/**
 * Run one aggregation round.
 *
 * Ordering matters: the aggregate is handed to the model service *before* it is
 * persisted. Persisting first and pushing second leaves the database advertising
 * an active model the inference service never received — exactly the split-brain
 * the rebuilding plan calls out. A snapshot therefore only ever exists for
 * weights the model service has confirmed.
 *
 * Returns `null` when too few valid participants are available.
 */
export async function runAggregationRound(deps: AggregationDeps): Promise<AggregationResult | null> {
  if (roundInProgress) throw new AggregationRoundInProgressError();
  roundInProgress = true;
  try {
    const rows = await deps.loadLatestUserWeights();
    const valid = rows.filter((r) => isValidWeightRow(r));
    if (valid.length < MIN_PARTICIPANTS) return null;

    const active = await deps.loadActiveGlobalModel();
    const base: LinearModel = active ?? {
      coeff: [Array(N_FEATURES).fill(0) as number[]],
      intercept: [0],
    };

    const aggregate = aggregateWeights(valid, base);
    const model: LinearModel = { coeff: aggregate.coeff, intercept: aggregate.intercept };

    let attempts = 0;
    let lastError: unknown;
    while (attempts < MODEL_SERVICE_PUSH_ATTEMPTS) {
      attempts++;
      try {
        await deps.pushToModelService(model);
        lastError = undefined;
        break;
      } catch (err) {
        lastError = err;
      }
    }
    if (lastError !== undefined) throw new ModelServiceUnavailableError(attempts, lastError);

    const saved = await deps.saveGlobalModel(model, aggregate.participants, aggregate.nSamplesTotal);

    return {
      participants: aggregate.participants,
      serialno: saved.serialno,
      coeff: model.coeff,
      intercept: model.intercept,
      n_samples_total: aggregate.nSamplesTotal,
      timestamp: saved.timestamp,
      modelService: "weights updated",
      pushAttempts: attempts,
    };
  } finally {
    roundInProgress = false;
  }
}

export { MODEL_CONTRACT };
