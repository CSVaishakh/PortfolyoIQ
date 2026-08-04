// Run once: node scripts/generate-template.mjs
// Generates public/templates/portfolio-template.xlsx

import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../public/templates/portfolio-template.xlsx");

// ── Header row ────────────────────────────────────────────────────────────────
const headers = ["Symbol", "ISIN", "Sector", "Quantity", "Average Buy Price", "Current Price", "Target Weight %", "Purchase Date"];

// ── Example rows ──────────────────────────────────────────────────────────────
const examples = [
  ["SBIN",      "INE062A01020", "FINANCIAL SERVICES", 3,  1091.00, 1069.80, 40, "15-01-2024"],
  ["TATASTEEL", "INE081A01020", "METALS",              10, 190.95,  195.41, 25, "02-08-2025"],
  ["INFY",      "INE009A01021", "IT",                  5,  1450.00, 1523.60, 35, "20-11-2025"],
];

const ws = XLSX.utils.aoa_to_sheet([headers, ...examples]);

// ── Column widths ─────────────────────────────────────────────────────────────
ws["!cols"] = [
  { wch: 14 }, // Symbol
  { wch: 18 }, // ISIN
  { wch: 22 }, // Sector
  { wch: 12 }, // Quantity
  { wch: 20 }, // Average Buy Price
  { wch: 16 }, // Current Price
  { wch: 18 }, // Target Weight %
  { wch: 16 }, // Purchase Date
];

// ── Freeze the header row ─────────────────────────────────────────────────────
ws["!freeze"] = { xSplit: 0, ySplit: 1 };

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Portfolio");

fs.mkdirSync(path.dirname(outPath), { recursive: true });
XLSX.writeFile(wb, outPath);

console.log("Template written to", outPath);
