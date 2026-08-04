/**
 * HTTP-level tests for the client and model routers.
 *
 * A real Express app with the real auth middleware is started on an ephemeral
 * port; only the database queries and the model-service call are substituted.
 * That keeps status codes, JWT handling and admin authorization under test.
 */

import { TEST_ADMIN_SECRET, TEST_JWT_SECRET } from "./setup-env.js";
import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import jwt from "jsonwebtoken";
import { createClientRouter, type ClientRouterConfig, type ClientRouterDeps } from "../src/routes/client.router.js";
import { createModelRouter, type ModelRouterConfig, type ModelRouterDeps } from "../src/routes/model.route.js";
import { MODEL_CONTRACT } from "../src/model-contract.js";
import { N_FEATURES, resetAggregationLock, type LinearModel } from "../src/federated.js";
import { MAX_UPLOAD_SAMPLES } from "../src/weight-validation.js";

const ADMIN_SECRET = TEST_ADMIN_SECRET;
const USER_ID = 42;

function tokenFor(userId: number, secret = TEST_JWT_SECRET): string {
  return jwt.sign({ sub: userId }, secret, { expiresIn: "1h" });
}

function validCoeff(): number[][] {
  return [Array.from({ length: N_FEATURES }, (_, i) => i / 100)];
}

function uploadBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    coef: validCoeff(),
    intercept: [0.1],
    n_samples: 250,
    feature_version: MODEL_CONTRACT.featureVersion,
    scaler_version: MODEL_CONTRACT.scalerVersion,
    model_version: MODEL_CONTRACT.modelVersion,
    ...overrides,
  };
}

// ── Test harness ──────────────────────────────────────────────────────────────

interface Harness {
  url: string;
  server: Server;
  savedUserWeights: unknown[];
  savedGlobalWeights: unknown[];
  pushedToModelService: LinearModel[];
}

const globalSnapshots: Array<Record<string, unknown>> = [];
let userWeightRows: Array<Record<string, unknown>> = [];
let modelServiceUp = true;

function buildHarness(
  clientConfig: Partial<ClientRouterConfig> = {},
  modelConfig: Partial<ModelRouterConfig> = {},
): Promise<Harness> {
  const savedUserWeights: unknown[] = [];
  const savedGlobalWeights: unknown[] = [];
  const pushedToModelService: LinearModel[] = [];

  const clientDeps: ClientRouterDeps = {
    getUserById: async (userId: number) =>
      (userId === USER_ID ? { userid: USER_ID, username: "tester", email: "tester@example.com" } : null) as never,
    getLatestGlobalModel: async () => (globalSnapshots.at(-1) ?? null) as never,
    getLatestUserWeights: async () => (userWeightRows.at(-1) ?? null) as never,
    saveUserWeights: async (userId, coeff, intercept, nSamples, fv, sv, mv, auc) => {
      const row = {
        serialno: savedUserWeights.length + 1,
        userid: userId,
        coeff,
        intercept,
        n_samples: nSamples,
        feature_version: fv,
        scaler_version: sv,
        model_version: mv,
        validation_auc: auc,
        timestamp: new Date(0),
      };
      savedUserWeights.push(row);
      userWeightRows.push(row);
      return row as never;
    },
    getUserModelHistory: async () => userWeightRows as never,
  };

  const modelDeps: ModelRouterDeps = {
    getAllLatestUserWeights: async () => userWeightRows as never,
    getLatestGlobalModel: async () => (globalSnapshots.at(-1) ?? null) as never,
    getGlobalModelBySerial: async (serialno: number) =>
      (globalSnapshots.find((s) => s["serialno"] === serialno) ?? null) as never,
    saveGlobalWeights: async (coeff, intercept, participants, nSamplesTotal, fv, sv, mv) => {
      const row = {
        serialno: globalSnapshots.length + 1,
        coeff,
        intercept,
        participants,
        n_samples_total: nSamplesTotal,
        feature_version: fv,
        scaler_version: sv,
        model_version: mv,
        timestamp: new Date(0),
      };
      globalSnapshots.push(row);
      savedGlobalWeights.push(row);
      return row as never;
    },
    modelService: {
      async pushWeights(model) {
        if (!modelServiceUp) throw new Error("model service unreachable");
        pushedToModelService.push(model);
      },
      async trainOnDataset() {
        if (!modelServiceUp) throw new Error("model service unreachable");
        return {
          n_samples: 30_000,
          n_features: N_FEATURES,
          classes: [0, 1],
          coeff: validCoeff(),
          intercept: [0.05],
          message: "trained",
        };
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use("/client", createClientRouter(clientDeps, {
    federatedContributionsEnabled: true,
    outcomeBasedModelEnabled: false,
    demoModelEnabled: true,
    uploadIntervalMs: 60 * 60 * 1000,
    ...clientConfig,
  }));
  app.use("/model", createModelRouter(modelDeps, {
    adminSecret: ADMIN_SECRET,
    federatedAggregationEnabled: true,
    demoModelEnabled: true,
    ...modelConfig,
  }));

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, server, savedUserWeights, savedGlobalWeights, pushedToModelService });
    });
  });
}

let harness: Harness;

before(async () => { harness = await buildHarness(); });
after(() => { harness.server.close(); });

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${harness.url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${harness.url}${path}`, { headers });
  return { status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> };
}

// ── Authentication ────────────────────────────────────────────────────────────

test("client routes reject a request with no token", async () => {
  assert.equal((await get("/client/profile")).status, 403);
});

test("client routes reject a token signed with the wrong secret", async () => {
  const forged = tokenFor(USER_ID, "not-the-real-secret");
  assert.equal((await get("/client/profile", { token: forged })).status, 403);
});

test("client routes reject a structurally invalid token", async () => {
  assert.equal((await get("/client/profile", { token: "not-a-jwt" })).status, 403);
});

test("a valid token reaches the handler", async () => {
  const res = await get("/client/profile", { token: tokenFor(USER_ID) });
  assert.equal(res.status, 200);
  assert.equal((res.body["user"] as Record<string, unknown>)["email"], "tester@example.com");
});

// ── Authorization ─────────────────────────────────────────────────────────────

test("a non-admin cannot aggregate, seed, train or roll back global model state", async () => {
  for (const path of ["/model/aggregate", "/model/train", "/model/seed", "/model/rollback/1"]) {
    assert.equal((await post(path, {})).status, 403, `${path} must require the admin secret`);
    assert.equal(
      (await post(path, {}, { "x-admin-secret": "wrong" })).status,
      403,
      `${path} must reject a wrong admin secret`,
    );
  }
});

test("a user JWT is not accepted in place of the admin secret", async () => {
  const res = await post("/model/aggregate", {}, { token: tokenFor(USER_ID) });
  assert.equal(res.status, 403);
});

// ── Upload validation ─────────────────────────────────────────────────────────

test("a well-formed contribution is accepted once", async () => {
  const isolated = await buildHarness();
  const res = await fetch(`${isolated.url}/client/model/weights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: tokenFor(USER_ID) },
    body: JSON.stringify(uploadBody()),
  });
  assert.equal(res.status, 201);
  assert.equal(isolated.savedUserWeights.length, 1);
  isolated.server.close();
});

test("malformed, non-finite, mis-versioned and implausible uploads are rejected predictably", async () => {
  const cases: Array<[string, Record<string, unknown>, number]> = [
    ["missing every field", {}, 400],
    ["missing the contract versions", { coef: validCoeff(), intercept: [0], n_samples: 10 }, 400],
    ["coef is not a matrix", uploadBody({ coef: [0.1, 0.2] }), 400],
    ["coef is the wrong width", uploadBody({ coef: [Array(N_FEATURES - 1).fill(0.1)] }), 400],
    ["coef holds a string", uploadBody({ coef: [Array(N_FEATURES).fill("0.1")] }), 400],
    ["coef holds null", uploadBody({ coef: [[null, ...Array(N_FEATURES - 1).fill(0.1)]] }), 400],
    ["intercept has two values", uploadBody({ intercept: [0.1, 0.2] }), 400],
    ["n_samples is zero", uploadBody({ n_samples: 0 }), 400],
    ["n_samples is negative", uploadBody({ n_samples: -1 }), 400],
    ["n_samples is a string", uploadBody({ n_samples: "500" }), 400],
    ["n_samples claims a million rows", uploadBody({ n_samples: 1_000_000 }), 400],
    ["n_samples is just over the cap", uploadBody({ n_samples: MAX_UPLOAD_SAMPLES + 1 }), 400],
    ["validation_auc is out of range", uploadBody({ validation_auc: 1.4 }), 400],
    ["feature_version is stale", uploadBody({ feature_version: MODEL_CONTRACT.featureVersion + 1 }), 409],
    ["scaler_version is stale", uploadBody({ scaler_version: MODEL_CONTRACT.scalerVersion + 9 }), 409],
    ["model_version is stale", uploadBody({ model_version: MODEL_CONTRACT.modelVersion + 1 }), 409],
    ["versions are fractional", uploadBody({ feature_version: 1.2 }), 409],
  ];

  for (const [label, body, expected] of cases) {
    // A fresh harness per case: the per-account throttle would otherwise mask
    // the validation result of the second and later requests.
    const isolated = await buildHarness();
    const res = await fetch(`${isolated.url}/client/model/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: tokenFor(USER_ID) },
      body: JSON.stringify(body),
    });
    assert.equal(res.status, expected, `${label}: expected ${expected}, got ${res.status}`);
    assert.equal(isolated.savedUserWeights.length, 0, `${label} must not be persisted`);
    isolated.server.close();
  }
});

test("non-finite coefficients survive neither JSON nor validation", async () => {
  const isolated = await buildHarness();
  // JSON has no NaN/Infinity literal, so a client must send them as strings or
  // nulls — both of which the finiteness check rejects.
  for (const poison of ["NaN", "Infinity", null]) {
    const res = await fetch(`${isolated.url}/client/model/weights`, {
      method: "POST",
      headers: { "Content-Type": "application/json", token: tokenFor(USER_ID) },
      body: JSON.stringify(uploadBody({ coef: [[poison, ...Array(N_FEATURES - 1).fill(0.1)]] })),
    });
    assert.equal(res.status, 400);
  }
  assert.equal(isolated.savedUserWeights.length, 0);
  isolated.server.close();
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

test("a second contribution inside the window is throttled, not stored", async () => {
  const isolated = await buildHarness();
  const send = () => fetch(`${isolated.url}/client/model/weights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: tokenFor(USER_ID) },
    body: JSON.stringify(uploadBody()),
  });

  assert.equal((await send()).status, 201);
  assert.equal((await send()).status, 429);
  assert.equal(isolated.savedUserWeights.length, 1);
  isolated.server.close();
});

test("throttling the upload does not lock the user out of their profile", async () => {
  const isolated = await buildHarness();
  await fetch(`${isolated.url}/client/model/weights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: tokenFor(USER_ID) },
    body: JSON.stringify(uploadBody()),
  });
  const profile = await fetch(`${isolated.url}/client/profile`, { headers: { token: tokenFor(USER_ID) } });
  assert.equal(profile.status, 200);
  isolated.server.close();
});

// ── Feature flags ─────────────────────────────────────────────────────────────

test("contributions are refused while the federated pipeline is paused", async () => {
  const paused = await buildHarness({ federatedContributionsEnabled: false });
  const res = await fetch(`${paused.url}/client/model/weights`, {
    method: "POST",
    headers: { "Content-Type": "application/json", token: tokenFor(USER_ID) },
    body: JSON.stringify(uploadBody()),
  });
  assert.equal(res.status, 503);
  assert.equal(paused.savedUserWeights.length, 0);
  paused.server.close();
});

test("the global model is withheld while every model flag is off", async () => {
  const paused = await buildHarness({ outcomeBasedModelEnabled: false, demoModelEnabled: false });
  const res = await fetch(`${paused.url}/client/model/global`, { headers: { token: tokenFor(USER_ID) } });
  assert.equal(res.status, 503);
  paused.server.close();
});

test("aggregation is refused while it is paused, even for an admin", async () => {
  const paused = await buildHarness({}, { federatedAggregationEnabled: false });
  const res = await fetch(`${paused.url}/model/aggregate`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
  });
  assert.equal(res.status, 503);
  paused.server.close();
});

// ── Aggregation over HTTP ─────────────────────────────────────────────────────

test("aggregation answers 400 when too few valid participants exist", async () => {
  resetAggregationLock();
  const saved = userWeightRows;
  userWeightRows = [];
  const isolated = await buildHarness();
  const res = await fetch(`${isolated.url}/model/aggregate`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
  });
  assert.equal(res.status, 400);
  isolated.server.close();
  userWeightRows = saved;
});

test("a model service that never confirms yields 502 and activates nothing", async () => {
  resetAggregationLock();
  const saved = userWeightRows;
  userWeightRows = [
    { coeff: validCoeff(), intercept: [0.1], n_samples: 100, userid: 1, ...MODEL_CONTRACT_ROW() },
    { coeff: validCoeff(), intercept: [0.2], n_samples: 200, userid: 2, ...MODEL_CONTRACT_ROW() },
  ];
  const snapshotsBefore = globalSnapshots.length;
  modelServiceUp = false;

  const isolated = await buildHarness();
  const res = await fetch(`${isolated.url}/model/aggregate`, {
    method: "POST",
    headers: { "x-admin-secret": ADMIN_SECRET },
  });
  assert.equal(res.status, 502);
  assert.equal(globalSnapshots.length, snapshotsBefore, "no snapshot may be activated");

  modelServiceUp = true;
  isolated.server.close();
  userWeightRows = saved;
});

function MODEL_CONTRACT_ROW() {
  return {
    feature_version: MODEL_CONTRACT.featureVersion,
    scaler_version: MODEL_CONTRACT.scalerVersion,
    model_version: MODEL_CONTRACT.modelVersion,
  };
}

test("rollback of an unknown snapshot is a 404, not a silent no-op", async () => {
  const res = await post("/model/rollback/99999", {}, { "x-admin-secret": ADMIN_SECRET });
  assert.equal(res.status, 404);
});

test("rollback rejects a non-numeric serial number", async () => {
  const res = await post("/model/rollback/abc", {}, { "x-admin-secret": ADMIN_SECRET });
  assert.equal(res.status, 400);
});
