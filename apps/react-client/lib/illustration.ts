import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCSV, resolveTargetWeights } from "./portfolioParser";
import { getLatestMarketFeatures, parseNiftyCSV } from "./marketData";
import { decideRebalance, type RebalanceDecision } from "./rebalanceEconomics";

/**
 * The landing page's sample output, computed at build time from a bundled
 * fixture.
 *
 * LP-05 rejects fabricated figures presented as product output and prefers a
 * real rendering of a checked-in fixture over an invented mock. This runs in a
 * server component, so the engine never reaches the browser bundle — only the
 * resulting numbers are serialised into the HTML.
 *
 * The mandate below is the one `test-data/README.md` documents for this
 * fixture, so the panel shows exactly what the product would show.
 */

const FIXTURE = "portfolio-1.csv";
const FIXTURE_DAYS_SINCE_REBALANCE = 95;
/**
 * A mandate, not a tuning knob — but a stated one. At the default risk
 * preference of 3 this fixture clears by hundredths of a basis point, which
 * reads on a landing page as a bug rather than as a narrow margin. 5 is an
 * ordinary preference for an investor who rebalances quarterly, and the caption
 * names it so the reader can reproduce the figures.
 */
const FIXTURE_RISK_AVERSION = 5;

export interface Illustration {
  fixture: string;
  decision: RebalanceDecision;
  marketDate: string | null;
}

export function loadIllustration(): Illustration | null {
  try {
    const portfolioCsv = readFileSync(
      join(process.cwd(), "..", "..", "test-data", FIXTURE),
      "utf8",
    );
    const { holdings } = parseCSV(portfolioCsv);
    const targets = resolveTargetWeights(holdings);
    if (targets.source !== "declared" || holdings.length === 0) return null;

    const marketCsv = readFileSync(
      join(process.cwd(), "public", "dataset", "nifty50-15y.csv"),
      "utf8",
    );
    const rows = parseNiftyCSV(marketCsv);
    const features = getLatestMarketFeatures(rows);
    if (!features) return null;

    const decision = decideRebalance(
      holdings,
      targets.targets,
      features.market_volatility_30d * Math.sqrt(252),
      {
        horizonDays: 365,
        riskAversion: FIXTURE_RISK_AVERSION,
        accountType: "taxable",
        cashAvailableInr: 0,
      },
    );

    return {
      fixture: FIXTURE,
      decision,
      marketDate: rows.at(-1)?.date.toISOString().slice(0, 10) ?? null,
    };
  } catch {
    // A missing fixture must not fail the build; the panel is illustrative and
    // the page is complete without it.
    return null;
  }
}

/** `FIXTURE_DAYS_SINCE_REBALANCE` is documentation for the caption, not an engine input. */
export const ILLUSTRATION_MANDATE = `${FIXTURE_DAYS_SINCE_REBALANCE} days since last rebalance, ₹0 cash, 365-day horizon, risk ${FIXTURE_RISK_AVERSION}, taxable`;
