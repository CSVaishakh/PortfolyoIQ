/**
 * Shared display formatting.
 *
 * LN-01 requires every number and date in the client to go through one module
 * rather than ad-hoc `toLocaleString` calls, so the `en-IN` locale, the rupee
 * symbol and the precision rules of DV-08..DV-12 are decided in a single place.
 *
 * Precision rule (DV-12): nothing is rendered at more precision than its inputs
 * justify. Prices are entered at two decimals, so derived weights show one or
 * two, and volatility — a variance-derived figure — is shown as a percentage
 * rather than five raw decimals.
 */

const LOCALE = "en-IN";

/** ₹ with `en-IN` grouping. Whole rupees at ≥ ₹1,000, two decimals below (DV-08). */
export function formatCurrency(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat(LOCALE, {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: magnitude >= 1000 ? 0 : 2,
    minimumFractionDigits: magnitude >= 1000 ? 0 : 2,
  }).format(value);
}

/** Bare grouped number, no currency symbol — for table cells that carry the unit in the header. */
export function formatAmount(value: number): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  return new Intl.NumberFormat(LOCALE, {
    maximumFractionDigits: magnitude >= 1000 ? 0 : 2,
    minimumFractionDigits: magnitude >= 1000 ? 0 : 2,
  }).format(value);
}

/** A fraction (0.42) as a percentage ("42.0%"). Weights, returns, drift (DV-09). */
export function formatPercent(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  return `${(fraction * 100).toFixed(decimals)}%`;
}

/** As {@link formatPercent}, with an explicit sign — for changes and deltas (DV-09). */
export function formatSignedPercent(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return "—";
  const sign = fraction > 0 ? "+" : "";
  return `${sign}${(fraction * 100).toFixed(decimals)}%`;
}

/** Basis points to one decimal with the unit attached (DV-10). */
export function formatBps(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return "—";
  return `${value.toFixed(decimals)} bps`;
}

/** `DD MMM YYYY` for display (DV-11). */
export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** `DD MMM YYYY, HH:MM` — for audit timestamps where the time matters. */
export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** ISO `YYYY-MM-DD`, for exported files and `<input type="date">` values (DV-11). */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Whole days between a past ISO date and now, floored at zero. */
export function daysSince(isoDate: string): number {
  const then = new Date(isoDate);
  if (Number.isNaN(then.getTime())) return 0;
  const ms = Date.now() - then.getTime();
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** "3 days ago" / "today", for the freshness and audit surfaces. */
export function formatRelativeDays(days: number): string {
  if (!Number.isFinite(days)) return "—";
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

/** An integer count with its noun, pluralised. */
export function pluralise(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
