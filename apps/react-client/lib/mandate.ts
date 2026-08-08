import type { AccountType } from "./rebalanceEconomics";
import { toIsoDate } from "./format";

/**
 * Mandate input validation.
 *
 * `decideRebalance()` throws on non-finite or out-of-range policy values. AN-09
 * requires those throws to be unreachable from the UI, so every field is
 * checked here before a run can start and `Run` stays disabled until they all
 * pass (AN-10). Previously a cleared Horizon field produced `NaN` and surfaced
 * as "Unexpected error".
 *
 * Pure and free of React so the boundary cases — 0 cash, 0 horizon, risk 0 and
 * risk 10 — are directly testable.
 */

export interface MandateInput {
  /** ISO `YYYY-MM-DD`, or "" for "never / not recorded". */
  lastRebalanceDate: string;
  cashAvailable: string;
  horizonDays: string;
  riskAversion: string;
  accountType: AccountType;
}

export interface MandateValues {
  daysSinceRebalance: number;
  cashAvailableInr: number;
  horizonDays: number;
  riskAversion: number;
  accountType: AccountType;
}

export type MandateFieldErrors = Partial<Record<keyof MandateInput, string>>;

export interface MandateValidation {
  valid: boolean;
  errors: MandateFieldErrors;
  /** Present only when `valid` — the coerced values the engine consumes. */
  values: MandateValues | null;
}

export const MANDATE_DEFAULTS: MandateInput = {
  lastRebalanceDate: "",
  cashAvailable: "0",
  horizonDays: "365",
  riskAversion: "3",
  accountType: "taxable",
};

export const RISK_MIN = 0;
export const RISK_MAX = 10;
export const RISK_STEP = 0.5;

/**
 * Whole days between an ISO date and the reference instant, floored at zero.
 *
 * Both dates are taken at local midnight so the result is a calendar-day count
 * that does not shift with the time of day the analysis happens to be run.
 */
function daysBetween(isoDate: string, now: Date): number {
  const then = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(then.getTime())) return 0;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86_400_000));
}

export function validateMandate(input: MandateInput, now: Date = new Date()): MandateValidation {
  const errors: MandateFieldErrors = {};

  // Last rebalance — optional, but must be a real, non-future date if given.
  let daysSinceRebalance = 0;
  if (input.lastRebalanceDate) {
    const parsed = new Date(`${input.lastRebalanceDate}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) {
      errors.lastRebalanceDate = "Enter a valid date, or leave this blank.";
    } else if (input.lastRebalanceDate > toIsoDate(now)) {
      errors.lastRebalanceDate = "The last rebalance cannot be in the future.";
    } else {
      daysSinceRebalance = daysBetween(input.lastRebalanceDate, now);
    }
  }

  // Cash — AN-13: an empty box must not silently become a meaningful number.
  const cash = Number(input.cashAvailable);
  if (input.cashAvailable.trim() === "") {
    errors.cashAvailable = "Enter an amount, or 0 if you have no cash to deploy.";
  } else if (!Number.isFinite(cash)) {
    errors.cashAvailable = "Enter a number.";
  } else if (cash < 0) {
    errors.cashAvailable = "Available cash cannot be negative.";
  }

  const horizon = Number(input.horizonDays);
  if (input.horizonDays.trim() === "") {
    errors.horizonDays = "Enter a holding period in days.";
  } else if (!Number.isFinite(horizon)) {
    errors.horizonDays = "Enter a number.";
  } else if (horizon <= 0) {
    errors.horizonDays = "The horizon must be at least 1 day.";
  }

  const risk = Number(input.riskAversion);
  if (input.riskAversion.trim() === "") {
    errors.riskAversion = "Choose a risk preference.";
  } else if (!Number.isFinite(risk)) {
    errors.riskAversion = "Enter a number.";
  } else if (risk < RISK_MIN || risk > RISK_MAX) {
    errors.riskAversion = `Risk preference must be between ${RISK_MIN} and ${RISK_MAX}.`;
  }

  const valid = Object.keys(errors).length === 0;

  return {
    valid,
    errors,
    values: valid
      ? {
          daysSinceRebalance,
          cashAvailableInr: cash,
          horizonDays: horizon,
          riskAversion: risk,
          accountType: input.accountType,
        }
      : null,
  };
}

/** One-line reason the run cannot start, for the disabled `Run` control (AN-10). */
export function runBlockedReason(hasFile: boolean, validation: MandateValidation): string | null {
  if (!hasFile) return "Upload your filled template to run the analysis.";
  if (!validation.valid) return "Correct the highlighted mandate fields to run the analysis.";
  return null;
}
