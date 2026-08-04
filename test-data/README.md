# Portfolio intake fixtures

Hand-checkable portfolios for exercising the `/interact` upload path. They are
synthetic: symbols and sectors are real NIFTY names, but quantities, prices, and
mandates are constructed to land on a specific branch of the decision engine.

All four follow the download template exactly — `Symbol, ISIN, Sector, Quantity,
Average Buy Price, Current Price, Target Weight %, Purchase Date` — so they
parse with `source: "declared"` targets and no normalization notes. Each file's
`Target Weight %` column sums to exactly 100.

`portfolio_dual_decision.csv` is tab-separated on purpose; the rest are
comma-separated. Both delimiters must survive the parser.

## What each fixture demonstrates

`decideRebalance` returns `REBALANCE` only when all three of `shouldTrade`,
`hasExecutableTrades`, and `netBenefitBps > 0` hold. The four fixtures cover the
four ways that resolves.

| Fixture | Mandate | Decision | Path exercised |
|---------|---------|----------|----------------|
| `portfolio-0.csv` | today's weights | HOLD | No band is breached at all |
| `portfolio-1.csv` | weights as allocated at cost | REBALANCE | Bands breached, benefit exceeds cost |
| `portfolio-1-0.csv` | equal weight | HOLD | Bands breached, but no trade is executable |
| `portfolio_dual_decision.csv` | equal weight | either | Bands breached, decision turns on net benefit |

**`portfolio-0.csv`** — 15 holdings whose prices have barely moved off cost, with
the mandate set to the current weights. Every active weight is ~0, so nothing
breaches its band and the engine holds on the first test. Enter *10* days since
last rebalance to match the scenario it was built for.

**`portfolio-1.csv`** — the same universe after a hard financials rally
(BAJFINANCE +45%, HDFCBANK +33%) and a broad drawdown everywhere else
(WIPRO −34%, TATASTEEL −32%). The mandate is the allocation as originally
purchased, so the rally has pushed 11 positions outside their bands. Every lot
predates 2024, so sales are long-term and fall under the ₹1.25L exemption —
tax is 0 bps and the rebalance clears comfortably. Enter *95* days.

**`portfolio-1-0.csv`** — a moderately drifted book against an equal-weight
mandate. Eight positions breach, but the book is only ~₹95k and the largest
required sale is smaller than one DRREDDY share (₹6,120), so whole-share
rounding and the ₹1,000 minimum-trade floor leave nothing to execute. The engine
holds and says so explicitly rather than proposing fractional trades.

**`portfolio_dual_decision.csv`** — the same portfolio as `portfolio-1-0.csv`
with lot sizes ×10, which makes the same breaches executable. It is deliberately
parked near the boundary, and the financial lots are recent enough to be
short-term:

- Default policy → REBALANCE (benefit 6.3 bps, cost 5.9 bps of which 1.2 is
  tax, **net +0.4 bps**).
- `accountType: "tax-advantaged"`, `riskAversion: 1`, `horizonDays: 30` →
  HOLD (benefit 0.2 bps, cost 4.8 bps, **net −4.6 bps**).

The margin is thin by design — that is the point of the fixture. Treat a flip
after an engine change as a signal to look, not as a broken file.

## Reproducing the numbers

Figures above use annual market volatility **0.20** (what
`rebalanceEconomics.test.ts` uses) and `DEFAULT_REBALANCE_POLICY` unless stated.

Two properties are time-dependent and will drift as the repo ages:

- **Holding periods.** `Purchase Date` is absolute and the short/long-term split
  is measured against *today*. The dual fixture's short-term lots (Oct–Dec 2025)
  become long-term around Oct–Dec 2026, which removes its 1.2 bps of tax and
  turns the default case into an unambiguous REBALANCE. Roll those dates forward
  to keep the boundary behaviour.
- **Days since last rebalance** is a UI input, not a column — the parser never
  read the old `Days Since Last Rebalance` field, so it was dropped rather than
  left to imply otherwise. The values to enter are noted per fixture above.
