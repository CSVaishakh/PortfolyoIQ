/**
 * Boundary conditions for the upload contract and the per-account throttle.
 * The HTTP-level equivalents live in api.test.ts; these cover the exact edges
 * that are awkward to reach through a socket (clock control, off-by-one limits).
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  checkContributionRate,
  MAX_UPLOAD_SAMPLES,
  MIN_UPLOAD_INTERVAL_MS,
  validateUpload,
  validateWeightsPayload,
} from "../src/weight-validation.js";
import { MODEL_CONTRACT } from "../src/model-contract.js";
import { N_FEATURES } from "../src/federated.js";

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    coef: [Array(N_FEATURES).fill(0.1)],
    intercept: [0.2],
    n_samples: 100,
    feature_version: MODEL_CONTRACT.featureVersion,
    scaler_version: MODEL_CONTRACT.scalerVersion,
    model_version: MODEL_CONTRACT.modelVersion,
    ...overrides,
  };
}

test("a payload of exactly N_FEATURES is accepted; one either side is not", () => {
  assert.equal(validateWeightsPayload([Array(N_FEATURES).fill(0)], [0]).ok, true);
  assert.equal(validateWeightsPayload([Array(N_FEATURES - 1).fill(0)], [0]).ok, false);
  assert.equal(validateWeightsPayload([Array(N_FEATURES + 1).fill(0)], [0]).ok, false);
});

test("n_samples accepts the cap and rejects one above it", () => {
  const atCap = validateUpload(body({ n_samples: MAX_UPLOAD_SAMPLES }));
  assert.equal(atCap.ok, true);
  assert.equal(validateUpload(body({ n_samples: MAX_UPLOAD_SAMPLES + 1 })).ok, false);
  assert.equal(validateUpload(body({ n_samples: 1 })).ok, true);
});

test("validation_auc is optional but must be a probability when present", () => {
  assert.equal(validateUpload(body()).ok, true);
  assert.equal(validateUpload(body({ validation_auc: 0 })).ok, true);
  assert.equal(validateUpload(body({ validation_auc: 1 })).ok, true);
  assert.equal(validateUpload(body({ validation_auc: -0.01 })).ok, false);
  assert.equal(validateUpload(body({ validation_auc: 1.01 })).ok, false);

  const accepted = validateUpload(body({ validation_auc: 0.83 }));
  assert.ok(accepted.ok);
  assert.equal(accepted.value.validation_auc, 0.83);
  const absent = validateUpload(body());
  assert.ok(absent.ok);
  assert.equal(absent.value.validation_auc, null);
});

test("a mismatched contract returns 409 and reports the expected versions", () => {
  const result = validateUpload(body({ model_version: MODEL_CONTRACT.modelVersion + 1 }));
  assert.equal(result.ok, false);
  assert.ok(!result.ok);
  assert.equal(result.rejection.status, 409);
  assert.deepEqual(result.rejection.expected, MODEL_CONTRACT);
});

test("a shape problem returns 400 rather than a contract conflict", () => {
  const result = validateUpload(body({ coef: "not-a-matrix" }));
  assert.ok(!result.ok);
  assert.equal(result.rejection.status, 400);
});

test("the throttle opens exactly at the interval boundary", () => {
  const start = 1_000_000;
  assert.ok(checkContributionRate(start, start), "an immediate repeat is throttled");
  assert.ok(checkContributionRate(start, start + MIN_UPLOAD_INTERVAL_MS - 1), "one millisecond early is throttled");
  assert.equal(checkContributionRate(start, start + MIN_UPLOAD_INTERVAL_MS), null, "the boundary is allowed");
  assert.equal(checkContributionRate(undefined, start), null, "a first-ever contribution is allowed");
});

test("the throttle rejection carries HTTP 429", () => {
  const rejection = checkContributionRate(0, 1);
  assert.ok(rejection);
  assert.equal(rejection.status, 429);
});
