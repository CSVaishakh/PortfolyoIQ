/**
 * Environment for the test run.
 *
 * Must be the first import in any test that pulls in a router module: both
 * routers build a production instance at import time and fail fast when the
 * service is misconfigured. The DATABASE_URL below is deliberately unroutable —
 * every test substitutes the query layer, so a real connection is never opened.
 */

process.env["JWT_SECRET"] ??= "test-jwt-secret";
process.env["DATABASE_URL"] ??= "postgresql://unused:unused@127.0.0.1:1/unused";
process.env["ADMIN_SECRET"] ??= "test-admin-secret";
process.env["MODEL_SERVICE_SECRET"] ??= "test-model-service-secret";
process.env["MODEL_SERVICE_URL"] ??= "http://127.0.0.1:1";

export const TEST_JWT_SECRET = process.env["JWT_SECRET"]!;
export const TEST_ADMIN_SECRET = process.env["ADMIN_SECRET"]!;
