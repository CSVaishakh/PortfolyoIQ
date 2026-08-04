/**
 * Validation for client-uploaded model snapshots.
 *
 * Kept separate from the router so every rejection rule is unit-testable
 * without standing up Express, a JWT, or a database.
 */

import { hasCurrentModelContract, MODEL_CONTRACT } from "./model-contract.js";
import { isFiniteNumber, N_FEATURES } from "./federated.js";

/** Upper bound on a claimed training-set size, so nobody can buy the mean. */
export const MAX_UPLOAD_SAMPLES = 10_000;

/** Minimum spacing between two contributions from one account. */
export const MIN_UPLOAD_INTERVAL_MS = 60 * 60 * 1_000;

export interface UploadRejection {
  /** HTTP status the router should answer with. */
  status: number;
  error: string;
  expected?: typeof MODEL_CONTRACT;
}

export interface ValidatedUpload {
  coef: number[][];
  intercept: number[];
  n_samples: number;
  feature_version: number;
  scaler_version: number;
  model_version: number;
  validation_auc: number | null;
}

export type UploadValidation =
  | { ok: true; value: ValidatedUpload }
  | { ok: false; rejection: UploadRejection };

/**
 * Validate an uploaded linear-model payload's shape and finiteness.
 * Rejects malformed shapes, wrong feature widths and non-finite values — a single
 * malformed upload would otherwise poison the aggregated (mean) model.
 */
export function validateWeightsPayload(
  coef: unknown,
  intercept: unknown
): { ok: true; coef: number[][]; intercept: number[] } | { ok: false; error: string } {
  if (!Array.isArray(coef) || coef.length !== 1) {
    return { ok: false, error: "coef must be a 1×N matrix" };
  }
  if (!Array.isArray(coef[0]) || coef[0].length !== N_FEATURES) {
    return { ok: false, error: `coef must have exactly ${N_FEATURES} features` };
  }
  if (!Array.isArray(intercept) || intercept.length !== 1) {
    return { ok: false, error: "intercept must contain exactly one value" };
  }
  if (coef[0].some((v: unknown) => !isFiniteNumber(v))) {
    return { ok: false, error: "coef contains a non-finite value" };
  }
  if (intercept.some((v: unknown) => !isFiniteNumber(v))) {
    return { ok: false, error: "intercept contains a non-finite value" };
  }
  return { ok: true, coef: coef as number[][], intercept: intercept as number[] };
}

function isContractVersion(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v);
}

/**
 * Full request-body validation for `POST /client/model/weights`, returning the
 * exact status and message the route should use.
 */
export function validateUpload(body: Record<string, unknown>): UploadValidation {
  const { coef, intercept, n_samples, feature_version, scaler_version, model_version, validation_auc } = body;

  if (
    coef === undefined || intercept === undefined || n_samples === undefined
    || feature_version === undefined || scaler_version === undefined || model_version === undefined
  ) {
    return {
      ok: false,
      rejection: { status: 400, error: "weights, n_samples, and all model contract versions are required" },
    };
  }

  if (!isFiniteNumber(n_samples) || n_samples <= 0 || n_samples > MAX_UPLOAD_SAMPLES) {
    return {
      ok: false,
      rejection: {
        status: 400,
        error: `n_samples must be a positive finite number no greater than ${MAX_UPLOAD_SAMPLES}`,
      },
    };
  }

  if (
    !isContractVersion(feature_version) || !isContractVersion(scaler_version) || !isContractVersion(model_version)
    || !hasCurrentModelContract({ feature_version, scaler_version, model_version })
  ) {
    return {
      ok: false,
      rejection: {
        status: 409,
        error: "Model contract does not match the currently active feature/scaler/model versions.",
        expected: MODEL_CONTRACT,
      },
    };
  }

  if (validation_auc !== undefined && validation_auc !== null
    && (!isFiniteNumber(validation_auc) || validation_auc < 0 || validation_auc > 1)) {
    return {
      ok: false,
      rejection: { status: 400, error: "validation_auc must be a finite value from 0 to 1" },
    };
  }

  const shape = validateWeightsPayload(coef, intercept);
  if (!shape.ok) {
    return { ok: false, rejection: { status: 400, error: shape.error } };
  }

  return {
    ok: true,
    value: {
      coef: shape.coef,
      intercept: shape.intercept,
      n_samples,
      feature_version,
      scaler_version,
      model_version,
      validation_auc: validation_auc === undefined || validation_auc === null ? null : (validation_auc as number),
    },
  };
}

/**
 * Per-account contribution throttle. Returns the rejection when the caller is
 * still inside its cooling-off window, otherwise null.
 */
export function checkContributionRate(
  lastUploadAt: number | undefined,
  now: number,
  intervalMs: number = MIN_UPLOAD_INTERVAL_MS,
): UploadRejection | null {
  if (lastUploadAt !== undefined && now - lastUploadAt < intervalMs) {
    return { status: 429, error: "Only one federated contribution per account is allowed each hour." };
  }
  return null;
}
