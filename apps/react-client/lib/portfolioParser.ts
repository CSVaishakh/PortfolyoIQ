import Papa from "papaparse";
import * as XLSX from "xlsx";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PortfolioHolding {
  symbol: string;
  isin?: string;
  sector: string;
  investment_volume: number; // Quantity column
  avg_buy_price: number;     // Average Buy Price column
  current_price: number;     // Current Price column
  /** User-declared target allocation, retained as entered until resolved. */
  target_weight?: number;
  /** Optional tax-lot proxy for short/long-term gain estimation. */
  purchase_date?: Date;
}

export interface ParseResult {
  holdings: PortfolioHolding[];
  errors: string[];
}

// ── Fixed column contract ─────────────────────────────────────────────────────
// The template defines exactly these headers (case-insensitive match).

const REQUIRED_COLUMNS = [
  "symbol",
  "sector",
  "quantity",
  "average buy price",
  "current price",
] as const;

const TARGET_WEIGHT_COLUMNS = ["target weight %", "target weight", "target allocation", "target allocation %"];
const PURCHASE_DATE_COLUMNS = ["purchase date", "buy date", "acquisition date"];

// ── Row mapper ────────────────────────────────────────────────────────────────

function normalise(s: string): string {
  return s.trim().toLowerCase();
}

function firstValue(lookup: Record<string, string>, names: string[]): string | undefined {
  return names.map((name) => lookup[name]?.trim()).find((value) => value);
}

function parsePurchaseDate(value: string): Date | null {
  const iso = /^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})$/.exec(value);
  const dayFirst = /^([0-9]{1,2})[/-]([0-9]{1,2})[/-]([0-9]{4})$/.exec(value);
  const parsed = iso
    ? new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]))
    : dayFirst
      ? new Date(Number(dayFirst[3]), Number(dayFirst[2]) - 1, Number(dayFirst[1]))
      : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function validateHeaders(headers: string[]): string[] {
  const normalised = headers.map(normalise);
  return REQUIRED_COLUMNS.filter((col) => !normalised.includes(col)).map(
    (col) => `Missing required column: "${col}"`
  );
}

function mapRow(
  row: Record<string, string>,
  headers: string[],
  rowIndex: number,
  errors: string[]
): PortfolioHolding | null {
  // Build a normalised-key lookup so casing in the file doesn't matter
  const lookup: Record<string, string> = {};
  for (const h of headers) {
    lookup[normalise(h)] = row[h] ?? "";
  }

  const symbol = lookup["symbol"]?.trim();
  const sector = lookup["sector"]?.trim();
  const volume = parseFloat(lookup["quantity"]);
  const avgBuy = parseFloat(lookup["average buy price"]);
  const curPrice = parseFloat(lookup["current price"]);

  if (!symbol || !sector) {
    errors.push(`Row ${rowIndex}: skipped — Symbol or Sector is empty`);
    return null;
  }

  if (isNaN(volume) || isNaN(avgBuy) || isNaN(curPrice)) {
    errors.push(`Row ${rowIndex}: skipped — Quantity, Average Buy Price, or Current Price is not a number`);
    return null;
  }

  if (volume <= 0 || avgBuy <= 0 || curPrice <= 0) {
    errors.push(`Row ${rowIndex}: skipped — Quantity, Average Buy Price, and Current Price must be positive`);
    return null;
  }

  let target_weight: number | undefined;
  const targetRaw = firstValue(lookup, TARGET_WEIGHT_COLUMNS);
  if (targetRaw) {
    const parsed = Number.parseFloat(targetRaw.replace("%", ""));
    if (!Number.isFinite(parsed) || parsed < 0) {
      errors.push(`Row ${rowIndex}: target weight must be a non-negative number`);
    } else {
      target_weight = parsed;
    }
  }

  let purchase_date: Date | undefined;
  const purchaseDateRaw = firstValue(lookup, PURCHASE_DATE_COLUMNS);
  if (purchaseDateRaw) {
    const parsed = parsePurchaseDate(purchaseDateRaw);
    if (!parsed || parsed.getTime() > Date.now()) {
      errors.push(`Row ${rowIndex}: purchase date must be a past DD-MM-YYYY or YYYY-MM-DD date`);
    } else {
      purchase_date = parsed;
    }
  }

  return {
    symbol,
    sector,
    investment_volume: volume,
    avg_buy_price: avgBuy,
    current_price: curPrice,
    ...(lookup["isin"] ? { isin: lookup["isin"].trim() } : {}),
    ...(target_weight === undefined ? {} : { target_weight }),
    ...(purchase_date ? { purchase_date } : {}),
  };
}

export interface ResolvedTargets {
  targets: number[];
  source: "declared" | "missing" | "invalid";
  notes: string[];
}

/** Resolve declared targets to fractions summing to one. A target mandate is required. */
export function resolveTargetWeights(holdings: PortfolioHolding[]): ResolvedTargets {
  if (!holdings.length) return { targets: [], source: "missing", notes: [] };
  if (holdings.some((holding) => holding.target_weight === undefined)) {
    return {
      targets: [],
      source: "missing",
      notes: ["A target weight is required for every holding before a live recommendation can be produced."],
    };
  }
  const raw = holdings.map((holding) => holding.target_weight!);
  const total = raw.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return { targets: [], source: "invalid", notes: ["Declared target weights must add to a positive total."] };
  }
  const notes = Math.abs(total - 1) < 0.01 || Math.abs(total - 100) < 1
    ? []
    : [`Declared targets sum to ${total.toFixed(2)} and were normalized to 100%.`];
  return { targets: raw.map((weight) => weight / total), source: "declared", notes };
}

// ── CSV parser ────────────────────────────────────────────────────────────────

export function parseCSV(content: string): ParseResult {
  const errors: string[] = [];

  const { data, errors: parseErrors } = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  if (parseErrors.length) {
    errors.push(...parseErrors.map((e) => `CSV parse error: ${e.message}`));
  }

  if (!data.length) return { holdings: [], errors: ["File is empty."] };

  const headers = Object.keys(data[0]);
  const headerErrors = validateHeaders(headers);
  if (headerErrors.length) {
    return { holdings: [], errors: headerErrors };
  }

  const holdings: PortfolioHolding[] = [];
  for (let i = 0; i < data.length; i++) {
    const h = mapRow(data[i], headers, i + 2, errors);
    if (h) holdings.push(h);
  }

  return { holdings, errors };
}

// ── Excel parser ──────────────────────────────────────────────────────────────

export function parseExcel(buffer: ArrayBuffer): ParseResult {
  const errors: string[] = [];

  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { holdings: [], errors: ["Excel file has no sheets."] };

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
    defval: "",
    raw: false,
  });

  if (!rows.length) return { holdings: [], errors: ["Sheet is empty."] };

  const headers = Object.keys(rows[0]);
  const headerErrors = validateHeaders(headers);
  if (headerErrors.length) {
    return { holdings: [], errors: headerErrors };
  }

  const holdings: PortfolioHolding[] = [];
  for (let i = 0; i < rows.length; i++) {
    const h = mapRow(rows[i], headers, i + 2, errors);
    if (h) holdings.push(h);
  }

  return { holdings, errors };
}

// ── File entry point ──────────────────────────────────────────────────────────

export async function parsePortfolioFile(file: File): Promise<ParseResult> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "csv") {
    const text = await file.text();
    return parseCSV(text);
  }

  if (ext === "xlsx" || ext === "xls") {
    const buffer = await file.arrayBuffer();
    return parseExcel(buffer);
  }

  return {
    holdings: [],
    errors: [`Unsupported file type ".${ext}". Please use the provided template (CSV or Excel).`],
  };
}
