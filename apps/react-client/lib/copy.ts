/**
 * Fixed product copy.
 *
 * The disclosure and privacy statements are specified word-for-word by CN-01
 * and CN-05. Holding them here means they are quoted, not paraphrased, wherever
 * they appear — and that changing them is a single, reviewable edit.
 */

/** CN-01. Required on `/`, on `/interact`, and on any exported or printed result. */
export const DISCLOSURE =
  "PortfolioIQ is an educational prototype. Its output is a deterministic estimate based on the " +
  "figures you provide. It is not investment, tax, or broker execution advice.";

/**
 * CN-05. Stated in exactly this scope — data minimisation, not anonymity, and
 * not secure aggregation.
 */
export const PRIVACY_CLAIM =
  "Your holdings are parsed and analysed in your browser and are never transmitted. If model " +
  "contributions are enabled, only model coefficients would be uploaded — that is data " +
  "minimisation, not anonymity or secure aggregation.";

/** AN-01. The template's column contract, quoted from lib/portfolioParser.ts. */
export const TEMPLATE_COLUMNS = {
  required: ["Symbol", "Sector", "Quantity", "Average Buy Price", "Current Price"],
  /** Required for a live decision, though the file parses without it (AN-02). */
  requiredForDecision: ["Target Weight %"],
  optional: ["ISIN", "Purchase Date"],
} as const;

/** DV-03. Accepted header spellings, which the UI has to document. */
export const COLUMN_ALIASES = {
  "Target Weight %": ["Target Weight", "Target Allocation", "Target Allocation %"],
  "Purchase Date": ["Buy Date", "Acquisition Date"],
} as const;
