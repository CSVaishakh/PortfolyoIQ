import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import {
  aggregateWeights,
  avgVector,
  clipUpdate,
  isValidWeightRow,
  MAX_UPDATE_L2_NORM,
  MIN_PARTICIPANTS,
  MODEL_SERVICE_PUSH_ATTEMPTS,
  N_FEATURES,
  resetAggregationLock,
  runAggregationRound,
  AggregationRoundInProgressError,
  ModelServiceUnavailableError,
  type AggregationDeps,
  type LinearModel,
  type WeightRow,
} from "../src/federated.js";
import { MODEL_CONTRACT } from "../src/model-contract.js";

const ZERO_MODEL: LinearModel = { coeff: [Array(N_FEATURES).fill(0)], intercept: [0] };

function row(overrides: Partial<WeightRow> = {}): WeightRow {
  return {
    coeff: [Array(N_FEATURES).fill(1)],
    intercept: [0.5],
    n_samples: 10,
    feature_version: MODEL_CONTRACT.featureVersion,
    scaler_version: MODEL_CONTRACT.scalerVersion,
    model_version: MODEL_CONTRACT.modelVersion,
    ...overrides,
  };
}

/** Row whose coefficients are a constant, so expected means are easy to state. */
function constantRow(value: number, nSamples: number): WeightRow {
  return row({ coeff: [Array(N_FEATURES).fill(value)], intercept: [value], n_samples: nSamples });
}

beforeEach(() => resetAggregationLock());

// ── Upload/row validation matrix (plan: required test 3) ─────────────────────

test("a well-formed contract-current row is accepted", () => {
  assert.equal(isValidWeightRow(row()), true);
});

test("wrong-width, non-finite, wrong-version and bad-sample rows are all rejected", () => {
  const cases: Array<[string, WeightRow]> = [
    ["coeff is not a 1×N matrix", row({ coeff: Array(N_FEATURES).fill(1) })],
    ["coeff has too few features", row({ coeff: [Array(N_FEATURES - 1).fill(1)] })],
    ["coeff has too many features", row({ coeff: [Array(N_FEATURES + 1).fill(1)] })],
    ["coeff holds NaN", row({ coeff: [[NaN, ...Array(N_FEATURES - 1).fill(1)]] })],
    ["coeff holds Infinity", row({ coeff: [[Infinity, ...Array(N_FEATURES - 1).fill(1)]] })],
    ["intercept has two values", row({ intercept: [0.1, 0.2] })],
    ["intercept holds NaN", row({ intercept: [NaN] })],
    ["n_samples is zero", row({ n_samples: 0 })],
    ["n_samples is negative", row({ n_samples: -5 })],
    ["n_samples is not a number", row({ n_samples: "40" })],
    ["feature_version is stale", row({ feature_version: MODEL_CONTRACT.featureVersion + 1 })],
    ["scaler_version is stale", row({ scaler_version: MODEL_CONTRACT.scalerVersion + 1 })],
    ["model_version is stale", row({ model_version: MODEL_CONTRACT.modelVersion + 1 })],
    ["feature_version is fractional", row({ feature_version: 1.5 })],
  ];

  for (const [label, candidate] of cases) {
    assert.equal(isValidWeightRow(candidate), false, `expected rejection: ${label}`);
  }
});

// ── Weighted FedAvg (plan: required test 4) ──────────────────────────────────

// Values below stay inside MAX_UPDATE_L2_NORM so these cases exercise the
// weighting rule alone; clipping has its own cases further down.
test("FedAvg weights each participant by its real sample count", () => {
  // 100 samples at 0.25 and 300 samples at 1.25 must land at 1.0, not the
  // unweighted midpoint of 0.75.
  const aggregate = aggregateWeights([constantRow(0.25, 100), constantRow(1.25, 300)], ZERO_MODEL);

  assert.equal(aggregate.participants, 2);
  assert.equal(aggregate.nSamplesTotal, 400);
  for (const value of aggregate.coeff[0]!) assert.ok(Math.abs(value - 1) < 1e-12);
  assert.ok(Math.abs(aggregate.intercept[0]! - 1) < 1e-12);
});

test("a one-sample participant cannot outvote a large one", () => {
  const aggregate = aggregateWeights([constantRow(0, 999), constantRow(1, 1)], ZERO_MODEL);
  // Expected mean: (999*0 + 1*1) / 1000 = 0.001
  assert.ok(Math.abs(aggregate.coeff[0]![0]! - 0.001) < 1e-12);
});

test("aggregation is deterministic and order-independent", () => {
  const rows = [constantRow(0.3, 7), constantRow(0.6, 13), constantRow(0.9, 29)];
  const forward = aggregateWeights(rows, ZERO_MODEL);
  const reversed = aggregateWeights([...rows].reverse(), ZERO_MODEL);

  assert.deepEqual(forward.coeff, aggregateWeights(rows, ZERO_MODEL).coeff);
  for (let i = 0; i < N_FEATURES; i++) {
    assert.ok(Math.abs(forward.coeff[0]![i]! - reversed.coeff[0]![i]!) < 1e-12);
  }
});

test("avgVector reduces to the plain mean when sample counts are equal", () => {
  assert.deepEqual(avgVector([[2], [4]], [1, 1]), [3]);
});

// ── Influence capping (plan: P3 clipping / influence caps) ───────────────────

test("an update inside the cap is passed through untouched", () => {
  const coeff = [Array(N_FEATURES).fill(0.1)];
  const intercept = [0.1];
  const clipped = clipUpdate(coeff, intercept, ZERO_MODEL.coeff, ZERO_MODEL.intercept);
  assert.deepEqual(clipped.coeff, coeff);
  assert.deepEqual(clipped.intercept, intercept);
});

test("an extreme update is scaled back to the influence cap, keeping its direction", () => {
  const coeff = [Array(N_FEATURES).fill(1000)];
  const intercept = [1000];
  const clipped = clipUpdate(coeff, intercept, ZERO_MODEL.coeff, ZERO_MODEL.intercept);

  const norm = Math.sqrt(
    [...clipped.coeff[0]!, clipped.intercept[0]!].reduce((sum, v) => sum + v ** 2, 0)
  );
  assert.ok(Math.abs(norm - MAX_UPDATE_L2_NORM) < 1e-9, `expected norm ${MAX_UPDATE_L2_NORM}, got ${norm}`);
  for (const value of clipped.coeff[0]!) assert.ok(value > 0, "direction must be preserved");
});

test("a poisoning attempt cannot move the model beyond the cap", () => {
  const honest = constantRow(0, 1000);
  const attacker = row({ coeff: [Array(N_FEATURES).fill(1e9)], intercept: [1e9], n_samples: 1000 });
  const aggregate = aggregateWeights([honest, attacker], ZERO_MODEL);

  const norm = Math.sqrt(
    [...aggregate.coeff[0]!, aggregate.intercept[0]!].reduce((sum, v) => sum + v ** 2, 0)
  );
  assert.ok(norm <= MAX_UPDATE_L2_NORM + 1e-9, `aggregate norm ${norm} exceeded the cap`);
});

// ── Round orchestration (plan: required test 5) ──────────────────────────────

interface RecordingDeps extends AggregationDeps {
  saved: Array<{ model: LinearModel; participants: number; nSamplesTotal: number }>;
  pushed: LinearModel[];
}

function makeDeps(options: {
  rows?: WeightRow[];
  active?: LinearModel | null;
  pushBehaviour?: (attempt: number) => Promise<void>;
  onSave?: () => Promise<void>;
} = {}): RecordingDeps {
  const saved: RecordingDeps["saved"] = [];
  const pushed: LinearModel[] = [];
  let pushAttempt = 0;

  return {
    saved,
    pushed,
    loadLatestUserWeights: async () => options.rows ?? [constantRow(1, 10), constantRow(3, 30)],
    loadActiveGlobalModel: async () => options.active ?? null,
    async saveGlobalModel(model, participants, nSamplesTotal) {
      if (options.onSave) await options.onSave();
      saved.push({ model, participants, nSamplesTotal });
      return { serialno: saved.length, timestamp: new Date(0) };
    },
    async pushToModelService(model) {
      pushAttempt++;
      if (options.pushBehaviour) await options.pushBehaviour(pushAttempt);
      pushed.push(model);
    },
  };
}

test("a round below the participant minimum aggregates nothing", async () => {
  const deps = makeDeps({ rows: [constantRow(1, 10)] });
  assert.equal(await runAggregationRound(deps), null);
  assert.equal(deps.saved.length, 0);
  assert.equal(deps.pushed.length, 0);
  assert.ok(MIN_PARTICIPANTS > 1);
});

test("invalid rows are dropped before the participant count is checked", async () => {
  const deps = makeDeps({ rows: [constantRow(1, 10), row({ intercept: [NaN] })] });
  assert.equal(await runAggregationRound(deps), null);
  assert.equal(deps.saved.length, 0);
});

test("a successful round pushes to the model service and then activates the snapshot", async () => {
  const deps = makeDeps();
  const result = await runAggregationRound(deps);

  assert.ok(result);
  assert.equal(result.participants, 2);
  assert.equal(result.n_samples_total, 40);
  assert.equal(result.pushAttempts, 1);
  assert.equal(result.modelService, "weights updated");
  assert.equal(deps.pushed.length, 1);
  assert.equal(deps.saved.length, 1);
  // The activated snapshot must be exactly what the model service received.
  assert.deepEqual(deps.saved[0]!.model, deps.pushed[0]);
});

test("a transient model-service failure is retried and then succeeds", async () => {
  const deps = makeDeps({
    pushBehaviour: async (attempt) => {
      if (attempt < MODEL_SERVICE_PUSH_ATTEMPTS) throw new Error("connection reset");
    },
  });

  const result = await runAggregationRound(deps);
  assert.ok(result);
  assert.equal(result.pushAttempts, MODEL_SERVICE_PUSH_ATTEMPTS);
  assert.equal(deps.saved.length, 1);
});

test("a model service that never confirms leaves no activated snapshot", async () => {
  const deps = makeDeps({ pushBehaviour: async () => { throw new Error("service down"); } });

  await assert.rejects(
    () => runAggregationRound(deps),
    (err: unknown) => {
      assert.ok(err instanceof ModelServiceUnavailableError);
      assert.equal(err.attempts, MODEL_SERVICE_PUSH_ATTEMPTS);
      return true;
    },
  );
  // No split-brain: the database must not advertise a model the service lacks.
  assert.equal(deps.saved.length, 0);
});

test("the round lock is released after a failure so the next round can run", async () => {
  const failing = makeDeps({ pushBehaviour: async () => { throw new Error("down"); } });
  await assert.rejects(() => runAggregationRound(failing));

  const healthy = makeDeps();
  assert.ok(await runAggregationRound(healthy));
});

test("concurrent aggregation requests cannot interleave into two active models", async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const deps = makeDeps({ onSave: () => gate });

  const first = runAggregationRound(deps);
  // The second request arrives while the first is still mid-round.
  await assert.rejects(() => runAggregationRound(deps), AggregationRoundInProgressError);

  release();
  assert.ok(await first);
  assert.equal(deps.saved.length, 1, "exactly one snapshot may be activated per round");
});

test("aggregation clips relative to the currently active model, not the origin", async () => {
  const active: LinearModel = { coeff: [Array(N_FEATURES).fill(2)], intercept: [2] };
  const deps = makeDeps({ rows: [constantRow(2, 10), constantRow(2, 10)], active });

  const result = await runAggregationRound(deps);
  assert.ok(result);
  // Participants sitting exactly on the active model leave it unchanged.
  for (const value of result.coeff[0]!) assert.ok(Math.abs(value - 2) < 1e-12);
});
