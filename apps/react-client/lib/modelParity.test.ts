/**
 * Cross-runtime contract parity.
 *
 * The browser (TensorFlow.js) and the model service (scikit-learn) exchange raw
 * coefficient vectors. That is only meaningful if both sides standardize
 * features identically and turn the same weights into the same probability.
 * Both runtimes assert against one shared fixture — see
 * apps/model-service/tests/test_parity.py for the Python half.
 */

import assert from "node:assert/strict";
import test from "node:test";
import FIXTURES from "../../../packages/model-contract/parity-fixtures.json";
import FEATURE_SPEC from "../../../packages/model-contract/feature-spec.json";
import {
  FEATURE_NAMES,
  MODEL_CONTRACT,
  SCALER_MEAN,
  SCALER_STD,
  standardizeFeatureMatrix,
  standardizeFeatureVector,
} from "./featureEngineering";

/**
 * Float64 tolerance for the pure arithmetic contract, and a looser float32
 * tolerance for the TensorFlow.js path, whose kernels are single precision.
 */
const EXACT_TOLERANCE = 1e-12;
const FLOAT32_TOLERANCE = 1e-5;

function assertClose(actual: number, expected: number, tolerance: number, label: string): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected}, got ${actual} (Δ ${Math.abs(actual - expected)} > ${tolerance})`,
  );
}

// ── The contract artifact itself ─────────────────────────────────────────────

test("the client reads its scaler from the shared feature spec, not a local copy", () => {
  assert.deepEqual(SCALER_MEAN, FEATURE_SPEC.scalerMean);
  assert.deepEqual(SCALER_STD, FEATURE_SPEC.scalerStd);
  assert.deepEqual(FEATURE_NAMES, FEATURE_SPEC.featureNames);
  assert.equal(FEATURE_NAMES.length, FIXTURES.nFeatures);
  assert.equal(SCALER_MEAN.length, FIXTURES.nFeatures);
  assert.equal(SCALER_STD.length, FIXTURES.nFeatures);
});

test("the parity fixture targets the currently active model contract", () => {
  assert.equal(FIXTURES.featureVersion, MODEL_CONTRACT.featureVersion);
  assert.equal(FIXTURES.scalerVersion, MODEL_CONTRACT.scalerVersion);
  assert.equal(FIXTURES.modelVersion, MODEL_CONTRACT.modelVersion);
});

// ── Scaler parity (plan: required test 1) ────────────────────────────────────

test("standardizing the fixture vectors reproduces the shared expected values", () => {
  FIXTURES.rawVectors.forEach((raw, rowIndex) => {
    const actual = standardizeFeatureVector(raw);
    const expected = FIXTURES.standardizedVectors[rowIndex]!;
    assert.equal(actual.length, FIXTURES.nFeatures);
    actual.forEach((value, column) => {
      assertClose(value, expected[column]!, EXACT_TOLERANCE, `row ${rowIndex} feature ${FEATURE_NAMES[column]}`);
    });
  });
});

test("the scaler mean maps to zero and one standard deviation maps to one", () => {
  for (const value of standardizeFeatureVector(SCALER_MEAN)) assertClose(value, 0, EXACT_TOLERANCE, "mean row");
  const oneSigma = SCALER_MEAN.map((mean, i) => mean + SCALER_STD[i]!);
  for (const value of standardizeFeatureVector(oneSigma)) assertClose(value, 1, EXACT_TOLERANCE, "one-sigma row");
});

test("standardizing a matrix is row-wise identical to standardizing each vector", () => {
  const matrix = standardizeFeatureMatrix(FIXTURES.rawVectors);
  FIXTURES.rawVectors.forEach((raw, i) => {
    assert.deepEqual(matrix[i], standardizeFeatureVector(raw));
  });
});

test("a zero-variance feature is mapped to zero rather than infinity", () => {
  // Guards the branch that keeps a degenerate scaler column finite.
  const degenerate = SCALER_STD.map(() => 0);
  const saved = [...SCALER_STD];
  try {
    degenerate.forEach((_, i) => { SCALER_STD[i] = 0; });
    for (const value of standardizeFeatureVector(SCALER_MEAN.map((m) => m + 5))) {
      assert.equal(value, 0);
      assert.ok(Number.isFinite(value));
    }
  } finally {
    saved.forEach((v, i) => { SCALER_STD[i] = v; });
  }
});

// ── Prediction parity (plan: required test 2) ────────────────────────────────

test("the canonical weight vector produces the shared expected logits", () => {
  const weights = FIXTURES.canonicalCoeff[0]!;
  const bias = FIXTURES.canonicalIntercept[0]!;

  FIXTURES.standardizedVectors.forEach((row, index) => {
    const logit = row.reduce((sum, value, i) => sum + value * weights[i]!, bias);
    assertClose(logit, FIXTURES.expectedLogits[index]!, EXACT_TOLERANCE, `logit ${index}`);

    const probability = 1 / (1 + Math.exp(-logit));
    assertClose(probability, FIXTURES.expectedProbabilities[index]!, EXACT_TOLERANCE, `probability ${index}`);
  });
});

test("the TensorFlow.js inference path agrees with the shared expected probabilities", async () => {
  const { default: LogisticRegression } = await import("../ts-model/logisticRegression");
  const model = new LogisticRegression({ C: 1.0, max_iter: 200, lr: 0.05 });
  model.setWeights(FIXTURES.canonicalCoeff, FIXTURES.canonicalIntercept);

  const standardized = FIXTURES.rawVectors.map((raw) => standardizeFeatureVector(raw));
  const probabilities = model.predict_proba(standardized);

  probabilities.forEach((row, index) => {
    assert.equal(row.length, 2, "predict_proba must mirror sklearn's two-column shape");
    assertClose(row[1]!, FIXTURES.expectedProbabilities[index]!, FLOAT32_TOLERANCE, `tfjs P(rebalance) ${index}`);
    assertClose(row[0]! + row[1]!, 1, FLOAT32_TOLERANCE, `tfjs probabilities sum ${index}`);
  });
});

test("the TensorFlow.js decision function agrees with the shared expected logits", async () => {
  const { default: LogisticRegression } = await import("../ts-model/logisticRegression");
  const model = new LogisticRegression({ C: 1.0, max_iter: 200, lr: 0.05 });
  model.setWeights(FIXTURES.canonicalCoeff, FIXTURES.canonicalIntercept);

  const standardized = FIXTURES.rawVectors.map((raw) => standardizeFeatureVector(raw));
  model.decision_function(standardized).forEach((logit, index) => {
    assertClose(logit, FIXTURES.expectedLogits[index]!, FLOAT32_TOLERANCE, `tfjs logit ${index}`);
  });
});

test("weights survive a set/get round trip unchanged, so an upload is what was trained", async () => {
  const { default: LogisticRegression } = await import("../ts-model/logisticRegression");
  const model = new LogisticRegression({ C: 1.0, max_iter: 200, lr: 0.05 });
  model.setWeights(FIXTURES.canonicalCoeff, FIXTURES.canonicalIntercept);

  const { coef, intercept } = model.getWeights();
  assert.deepEqual(coef, FIXTURES.canonicalCoeff);
  assert.deepEqual(intercept, FIXTURES.canonicalIntercept);
  assert.equal(coef[0]!.length, FIXTURES.nFeatures);
});
