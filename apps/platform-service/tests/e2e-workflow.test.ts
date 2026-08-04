/**
 * End-to-end federated workflow over real HTTP routes:
 *
 *   seed → two eligible clients contribute → admin aggregates → the versioned
 *   global model is activated → a client retrieves contract-compatible weights.
 *
 * Only the database and the model service are substituted; the routers, the
 * auth middleware, validation and the aggregation round are the real ones.
 */

import { TEST_ADMIN_SECRET, TEST_JWT_SECRET } from "./setup-env.js";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { createClientRouter } from "../src/routes/client.router.js";
import { createModelRouter } from "../src/routes/model.route.js";
import { MODEL_CONTRACT } from "../src/model-contract.js";
import { N_FEATURES, resetAggregationLock, type LinearModel } from "../src/federated.js";

interface GlobalRow {
  serialno: number;
  coeff: number[][];
  intercept: number[];
  participants: number;
  n_samples_total: number;
  feature_version: number;
  scaler_version: number;
  model_version: number;
  timestamp: Date;
}

interface UserRow {
  serialno: number;
  userid: number;
  coeff: number[][];
  intercept: number[];
  n_samples: number;
  feature_version: number;
  scaler_version: number;
  model_version: number;
  validation_auc: number | null;
  timestamp: Date;
}

// ── In-memory stand-ins for PostgreSQL and the model service ─────────────────

const globalRows: GlobalRow[] = [];
const userRows: UserRow[] = [];
/** What the inference service currently believes the active model is. */
let modelServiceState: LinearModel | null = null;

let server: Server;
let baseUrl: string;

function token(userId: number): string {
  return jwt.sign({ sub: userId }, TEST_JWT_SECRET, { expiresIn: "1h" });
}

function coeffFilledWith(value: number): number[][] {
  return [Array(N_FEATURES).fill(value)];
}

before(async () => {
  resetAggregationLock();

  const app = express();
  app.use(express.json());

  app.use("/client", createClientRouter(
    {
      getUserById: async (userid: number) => ({ userid, username: `user${userid}`, email: `u${userid}@example.com` }) as never,
      getLatestGlobalModel: async () => (globalRows.at(-1) ?? null) as never,
      getLatestUserWeights: async (userid: number) =>
        ([...userRows].reverse().find((r) => r.userid === userid) ?? null) as never,
      saveUserWeights: async (userid, coeff, intercept, n_samples, fv, sv, mv, auc) => {
        const row: UserRow = {
          serialno: userRows.length + 1,
          userid, coeff, intercept, n_samples,
          feature_version: fv, scaler_version: sv, model_version: mv,
          validation_auc: auc, timestamp: new Date(userRows.length),
        };
        userRows.push(row);
        return row as never;
      },
      getUserModelHistory: async (userid: number) => userRows.filter((r) => r.userid === userid) as never,
    },
    {
      federatedContributionsEnabled: true,
      outcomeBasedModelEnabled: false,
      demoModelEnabled: true,
      uploadIntervalMs: 60 * 60 * 1000,
    },
  ));

  app.use("/model", createModelRouter(
    {
      getAllLatestUserWeights: async () => {
        // Newest row per participant, mirroring the production query.
        const seen = new Set<number>();
        return [...userRows].reverse().filter((r) => {
          if (seen.has(r.userid)) return false;
          seen.add(r.userid);
          return true;
        }) as never;
      },
      getLatestGlobalModel: async () => (globalRows.at(-1) ?? null) as never,
      getGlobalModelBySerial: async (serialno) => (globalRows.find((r) => r.serialno === serialno) ?? null) as never,
      saveGlobalWeights: async (coeff, intercept, participants, n_samples_total, fv, sv, mv) => {
        const row: GlobalRow = {
          serialno: globalRows.length + 1,
          coeff, intercept, participants, n_samples_total,
          feature_version: fv, scaler_version: sv, model_version: mv,
          timestamp: new Date(globalRows.length),
        };
        globalRows.push(row);
        return row as never;
      },
      modelService: {
        async pushWeights(model) { modelServiceState = model; },
        async trainOnDataset() {
          const trained = { coeff: coeffFilledWith(0.2), intercept: [0.05] };
          modelServiceState = trained;
          return {
            n_samples: 30_000,
            n_features: N_FEATURES,
            classes: [0, 1],
            coeff: trained.coeff,
            intercept: trained.intercept,
            message: "Demonstration model trained",
          };
        },
      },
    },
    { adminSecret: TEST_ADMIN_SECRET, federatedAggregationEnabled: true, demoModelEnabled: true },
  ));

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

after(() => server.close());

function contributionFor(userId: number, value: number, nSamples: number) {
  return {
    coef: coeffFilledWith(value),
    intercept: [value / 10],
    n_samples: nSamples,
    feature_version: MODEL_CONTRACT.featureVersion,
    scaler_version: MODEL_CONTRACT.scalerVersion,
    model_version: MODEL_CONTRACT.modelVersion,
    validation_auc: 0.71,
    _userId: userId,
  };
}

// The steps below share state deliberately: this is one workflow, in order.

test("step 1 — an admin seeds a versioned global model from the demo dataset", async () => {
  const res = await fetch(`${baseUrl}/model/seed`, {
    method: "POST",
    headers: { "x-admin-secret": TEST_ADMIN_SECRET },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { n_samples: number; globalModel: { serialno: number } };

  assert.equal(body.n_samples, 30_000);
  assert.equal(globalRows.length, 1);
  assert.equal(globalRows[0]!.feature_version, MODEL_CONTRACT.featureVersion);
  assert.equal(globalRows[0]!.scaler_version, MODEL_CONTRACT.scalerVersion);
  assert.equal(globalRows[0]!.model_version, MODEL_CONTRACT.modelVersion);
  assert.ok(modelServiceState, "the model service must hold the seeded weights");
});

test("step 2 — a client warm-starts from the seeded global model", async () => {
  const res = await fetch(`${baseUrl}/client/model/global`, { headers: { token: token(1) } });
  assert.equal(res.status, 200);
  const body = await res.json() as Record<string, number>;

  assert.equal(body["feature_version"], MODEL_CONTRACT.featureVersion);
  assert.equal(body["scaler_version"], MODEL_CONTRACT.scalerVersion);
  assert.equal(body["model_version"], MODEL_CONTRACT.modelVersion);
});

test("step 3 — two eligible clients each contribute one snapshot", async () => {
  for (const [userId, value, samples] of [[1, 0.4, 120], [2, 0.8, 360]] as const) {
    const { _userId, ...payload } = contributionFor(userId, value, samples);
    void _userId;
    const res = await fetch(`${baseUrl}/client/model/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: token(userId) },
      body: JSON.stringify(payload),
    });
    assert.equal(res.status, 201, `user ${userId} contribution should be accepted`);
  }
  assert.equal(userRows.length, 2);
});

test("step 4 — a contract-incompatible contribution is refused and never aggregated", async () => {
  const res = await fetch(`${baseUrl}/client/model/weights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: token(3) },
    body: JSON.stringify({
      ...contributionFor(3, 0.5, 200),
      feature_version: MODEL_CONTRACT.featureVersion + 1,
    }),
  });
  assert.equal(res.status, 409);
  assert.equal(userRows.length, 2, "the incompatible upload must not be stored");
});

test("step 5 — the admin aggregates and the new global model is activated", async () => {
  const res = await fetch(`${baseUrl}/model/train`, {
    method: "POST",
    headers: { "x-admin-secret": TEST_ADMIN_SECRET },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as {
    participants: number;
    n_samples_total: number;
    modelService: string;
    globalModel: { serialno: number };
  };

  assert.equal(body.participants, 2);
  assert.equal(body.n_samples_total, 480);
  assert.equal(body.modelService, "weights updated");
  assert.equal(globalRows.length, 2, "aggregation must add exactly one snapshot");

  // The activated snapshot and the inference service must agree exactly.
  assert.deepEqual(globalRows.at(-1)!.coeff, modelServiceState!.coeff);
  assert.deepEqual(globalRows.at(-1)!.intercept, modelServiceState!.intercept);
});

test("step 6 — the aggregate is sample-weighted toward the larger contributor", async () => {
  const aggregated = globalRows.at(-1)!.coeff[0]![0]!;
  const [small, large] = [0.4, 0.8];
  const unweightedMean = (small + large) / 2;

  assert.ok(
    aggregated > unweightedMean,
    `expected the 360-sample client to pull the mean above ${unweightedMean}, got ${aggregated}`,
  );
  assert.ok(aggregated < large, "the aggregate must still sit between the two contributions");
});

test("step 7 — a client retrieves the new, contract-compatible global model", async () => {
  const res = await fetch(`${baseUrl}/client/model/global`, { headers: { token: token(1) } });
  assert.equal(res.status, 200);
  const body = await res.json() as { serialno: number; coef: number[][]; intercept: number[] } & Record<string, number>;

  assert.equal(body.serialno, globalRows.at(-1)!.serialno);
  assert.equal(body["feature_version"], MODEL_CONTRACT.featureVersion);
  assert.equal(body.coef[0]!.length, N_FEATURES, "the client must receive a full-width vector");
  assert.ok(body.coef[0]!.every((v) => Number.isFinite(v)));
  assert.equal(body.intercept.length, 1);
});

test("step 8 — an operator can roll back to the seeded snapshot with an intact audit trail", async () => {
  const seeded = globalRows[0]!;
  const historyLength = globalRows.length;

  const res = await fetch(`${baseUrl}/model/rollback/${seeded.serialno}`, {
    method: "POST",
    headers: { "x-admin-secret": TEST_ADMIN_SECRET },
  });
  assert.equal(res.status, 200);

  assert.equal(globalRows.length, historyLength + 1, "rollback appends rather than deleting history");
  assert.deepEqual(globalRows.at(-1)!.coeff, seeded.coeff);
  assert.deepEqual(modelServiceState!.coeff, seeded.coeff);
  assert.ok(globalRows.some((r) => r.serialno === seeded.serialno), "the original snapshot is still auditable");
});
