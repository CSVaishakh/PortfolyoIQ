/**
 * Mandate validation boundaries.
 *
 * `decideRebalance()` throws on non-finite or out-of-range policy values, and
 * AN-09 requires those throws to be unreachable from the UI. These cases are
 * the boundary NFR-05 names: zero cash, zero horizon, risk at 0 and at 10, and
 * the cleared field that previously produced `NaN` and surfaced as
 * "Unexpected error".
 */

import assert from "node:assert/strict";
import test from "node:test";
import { MANDATE_DEFAULTS, runBlockedReason, validateMandate, type MandateInput } from "./mandate";

const NOW = new Date("2026-08-08T12:00:00Z");

function input(patch: Partial<MandateInput> = {}): MandateInput {
  return { ...MANDATE_DEFAULTS, ...patch };
}

test("the defaults are valid and coerce to the engine's expected values", () => {
  const result = validateMandate(input(), NOW);
  assert.equal(result.valid, true);
  assert.deepEqual(result.values, {
    daysSinceRebalance: 0,
    cashAvailableInr: 0,
    horizonDays: 365,
    riskAversion: 3,
    accountType: "taxable",
  });
});

test("zero cash is accepted — it is the default, not an error", () => {
  const result = validateMandate(input({ cashAvailable: "0" }), NOW);
  assert.equal(result.valid, true);
  assert.equal(result.values?.cashAvailableInr, 0);
});

test("negative cash is rejected with a named reason", () => {
  const result = validateMandate(input({ cashAvailable: "-1" }), NOW);
  assert.equal(result.valid, false);
  assert.match(result.errors.cashAvailable ?? "", /cannot be negative/i);
  assert.equal(result.values, null);
});

test("a cleared cash field is rejected rather than silently becoming zero", () => {
  // AN-13: an empty box must not coerce to a meaningful value without saying so.
  const result = validateMandate(input({ cashAvailable: "" }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.errors.cashAvailable);
});

test("a cleared horizon is rejected — this is the NaN path that used to throw", () => {
  const result = validateMandate(input({ horizonDays: "" }), NOW);
  assert.equal(result.valid, false);
  assert.ok(result.errors.horizonDays);
  assert.equal(result.values, null);
});

test("a zero horizon is rejected; the engine requires a positive one", () => {
  const result = validateMandate(input({ horizonDays: "0" }), NOW);
  assert.equal(result.valid, false);
  assert.match(result.errors.horizonDays ?? "", /at least 1 day/i);
});

test("risk preference accepts both ends of its range", () => {
  for (const risk of ["0", "10", "0.5", "9.5"]) {
    const result = validateMandate(input({ riskAversion: risk }), NOW);
    assert.equal(result.valid, true, `risk ${risk} should be valid`);
    assert.equal(result.values?.riskAversion, Number(risk));
  }
});

test("risk preference outside 0–10 is rejected at both ends", () => {
  for (const risk of ["-0.5", "10.5"]) {
    const result = validateMandate(input({ riskAversion: risk }), NOW);
    assert.equal(result.valid, false, `risk ${risk} should be rejected`);
    assert.ok(result.errors.riskAversion);
  }
});

test("a future last-rebalance date is rejected", () => {
  const result = validateMandate(input({ lastRebalanceDate: "2026-09-01" }), NOW);
  assert.equal(result.valid, false);
  assert.match(result.errors.lastRebalanceDate ?? "", /future/i);
});

test("an empty last-rebalance date is allowed and means zero days", () => {
  const result = validateMandate(input({ lastRebalanceDate: "" }), NOW);
  assert.equal(result.valid, true);
  assert.equal(result.values?.daysSinceRebalance, 0);
});

test("a past last-rebalance date converts to whole days", () => {
  const result = validateMandate(input({ lastRebalanceDate: "2026-08-01" }), NOW);
  assert.equal(result.valid, true);
  assert.equal(result.values?.daysSinceRebalance, 7);
});

test("tax-advantaged accounts pass through unchanged", () => {
  const result = validateMandate(input({ accountType: "tax-advantaged" }), NOW);
  assert.equal(result.valid, true);
  assert.equal(result.values?.accountType, "tax-advantaged");
});

test("the run is blocked with a stated reason until a file and a valid mandate exist", () => {
  // AN-10: `Run` is disabled with the reason shown, never silently inert.
  const valid = validateMandate(input(), NOW);
  const invalid = validateMandate(input({ horizonDays: "" }), NOW);

  assert.match(runBlockedReason(false, valid) ?? "", /upload/i);
  assert.match(runBlockedReason(true, invalid) ?? "", /mandate/i);
  assert.equal(runBlockedReason(true, valid), null);
});
