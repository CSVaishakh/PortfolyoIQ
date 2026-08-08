/**
 * Platform-service client.
 *
 * One place for the base URL, the auth header shape and the response types, so
 * that GL-15 ("every network call MUST have a visible outcome") is structural:
 * `request` returns a discriminated union, never throws, and never resolves to
 * a value a caller can mistake for success.
 *
 * The endpoint contracts here mirror apps/platform-service/src/routes/*.ts
 * exactly and are not modified by the client.
 */

import { clearSession } from "./session";

export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:5000";

// ── Result type ───────────────────────────────────────────────────────────────

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
  /** User-legible cause. Never a bare "Something went wrong" (CN-06). */
  error: string;
  /** Present when the server explains what it expected — e.g. a version mismatch. */
  expected?: unknown;
  /** True when the failure was a transport error rather than an HTTP response. */
  unreachable?: boolean;
}

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

interface ErrorBody {
  error?: string;
  detail?: string;
  expected?: unknown;
}

interface RequestOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** User JWT, sent in the `token` header the platform service reads. */
  token?: string | null;
  /** Admin secret, sent in `x-admin-secret`. Held in memory only (SC-03). */
  adminSecret?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<ApiResult<T>> {
  const { method = "GET", body, token, adminSecret, signal } = options;

  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers["token"] = token;
  if (adminSecret) headers["x-admin-secret"] = adminSecret;

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ok: false, status: 0, error: "Request cancelled.", unreachable: true };
    }
    return {
      ok: false,
      status: 0,
      error: "Could not reach the server. Check your connection and try again.",
      unreachable: true,
    };
  }

  // 204 and other empty bodies must not blow up the JSON parse.
  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const errorBody = (parsed ?? {}) as ErrorBody;
    // GL-14: a rejected or expired token is cleared here, once, so no caller can
    // forget to — the UI then degrades to the unauthenticated path.
    if ((response.status === 401 || response.status === 403) && token) {
      clearSession();
    }
    return {
      ok: false,
      status: response.status,
      error: errorBody.error ?? errorBody.detail ?? `Server returned HTTP ${response.status}.`,
      expected: errorBody.expected,
    };
  }

  return { ok: true, data: parsed as T };
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  userid: number;
  username: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export function signIn(email: string, password: string): Promise<ApiResult<AuthResponse>> {
  return request<AuthResponse>("/auth/signin", { method: "POST", body: { email, password } });
}

export function signUp(
  username: string,
  email: string,
  password: string,
): Promise<ApiResult<AuthResponse>> {
  return request<AuthResponse>("/auth/signup", {
    method: "POST",
    body: { username, email, password },
  });
}

/**
 * The signed-in account. Also serves as the token's liveness check: a rejected
 * token is cleared by `request`, so the header degrades to signed-out on its own
 * (GL-07, GL-14).
 */
export function fetchProfile(token: string): Promise<ApiResult<{ user: AuthUser }>> {
  return request<{ user: AuthUser }>("/client/profile", { token });
}

// ── Client model ──────────────────────────────────────────────────────────────

export interface GlobalModelResponse {
  serialno: number;
  coef: number[][];
  intercept: number[];
  timestamp: string;
  feature_version: number;
  scaler_version: number;
  model_version: number;
  demo?: boolean;
}

export function fetchGlobalModel(token: string): Promise<ApiResult<GlobalModelResponse>> {
  return request<GlobalModelResponse>("/client/model/global", { token });
}

export interface WeightUploadBody {
  coef: number[][];
  intercept: number[];
  n_samples: number;
  feature_version: number;
  scaler_version: number;
  model_version: number;
  validation_auc: number;
}

export interface WeightUploadResponse {
  serialno: number;
  n_samples: number;
  timestamp: string;
}

export function uploadWeights(
  token: string,
  body: WeightUploadBody,
): Promise<ApiResult<WeightUploadResponse>> {
  return request<WeightUploadResponse>("/client/model/weights", { method: "POST", body, token });
}

// ── Admin model operations ────────────────────────────────────────────────────

export interface ModelStatusResponse {
  activeModel: {
    serialno: number;
    timestamp: string;
    participants: number;
    n_samples_total: number;
    feature_version: number;
    scaler_version: number;
    model_version: number;
  } | null;
  flags: {
    federatedAggregationEnabled: boolean;
    demoModelEnabled: boolean;
  };
}

/**
 * Read-only. Doubles as the side-effect-free secret check AD-01 requires: the
 * previous unlock ran a real FedAvg round purely to test the password.
 */
export function fetchModelStatus(adminSecret: string): Promise<ApiResult<ModelStatusResponse>> {
  return request<ModelStatusResponse>("/model/status", { adminSecret });
}

export interface ModelHistoryEntry {
  serialno: number;
  timestamp: string;
  participants: number;
  n_samples_total: number;
  feature_version: number;
  scaler_version: number;
  model_version: number;
}

export interface ModelHistoryResponse {
  page: number;
  limit: number;
  results: ModelHistoryEntry[];
}

export function fetchModelHistory(
  adminSecret: string,
  page = 1,
  limit = 10,
): Promise<ApiResult<ModelHistoryResponse>> {
  return request<ModelHistoryResponse>(`/model/history?page=${page}&limit=${limit}`, {
    adminSecret,
  });
}

export interface AggregationResponse {
  participants: number;
  n_samples_total: number;
  globalModel: { serialno: number; timestamp: string };
  modelService: string;
}

export function runAggregation(adminSecret: string): Promise<ApiResult<AggregationResponse>> {
  return request<AggregationResponse>("/model/train", { method: "POST", adminSecret });
}

export interface SeedResponse {
  message: string;
  n_samples: number;
  n_features: number;
  classes: number[];
  globalModel: { serialno: number; timestamp: string };
}

export function seedFromDataset(adminSecret: string): Promise<ApiResult<SeedResponse>> {
  return request<SeedResponse>("/model/seed", { method: "POST", adminSecret });
}

export interface RollbackResponse {
  message: string;
  globalModel: { serialno: number; timestamp: string };
}

export function rollbackModel(
  adminSecret: string,
  serialno: number,
): Promise<ApiResult<RollbackResponse>> {
  return request<RollbackResponse>(`/model/rollback/${serialno}`, {
    method: "POST",
    adminSecret,
  });
}
