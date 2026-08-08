# PortfolioIQ — Frontend / UI-UX Requirements Specification

| Field | Value |
|---|---|
| Document | Frontend & UI/UX Requirements Specification |
| Version | 1.0 (draft for review) |
| Date | 2026-08-04 |
| Applies to | `apps/react-client` (Next.js 16, React 19, TypeScript, Tailwind CSS 4) |
| Owner | vaishakh |
| Related documents | `README.md`, `rebuilding-plan.md`, `test-data/README.md`, `packages/model-contract/feature-spec.json` |
| Status of the described system | Partially implemented. §21 records the delta between this specification and the code on branch `rebuild-codex`. |

---

## 1. Purpose, scope and conventions

### 1.1 Purpose

This document specifies what the PortfolioIQ web client must do, show, refuse to
show, and feel like. It is written so that each requirement can be accepted or
rejected by inspection or by an automated test — not as a design mood board.

### 1.2 Scope

**In scope:** the four public routes of `apps/react-client` (`/`, `/auth`,
`/interact`, `/train`), their states, the client-side validation contract, the
visual system, accessibility, performance budgets, and the disclosure/copy rules
that follow from the product being educational decision support rather than
advice.

**Out of scope:** platform-service and model-service API design (they are fixed
contracts this client consumes), model mathematics, database schema, and
deployment. See §20 for explicit non-goals.

### 1.3 Requirement conventions

- **MUST** — mandatory; a release blocker if unmet.
- **SHOULD** — required unless there is a recorded reason not to.
- **MAY** — optional.
- IDs are stable. Do not renumber; deprecate instead.

| Prefix | Area |
|---|---|
| `GL` | Global / cross-route |
| `LP` | Landing page |
| `AU` | Authentication |
| `AN` | Analysis (`/interact`) |
| `AD` | Admin (`/train`) |
| `DV` | Data & validation |
| `CN` | Content & disclosure |
| `DS` | Design system |
| `AX` | Accessibility |
| `RS` | Responsive layout |
| `PF` | Performance |
| `SC` | Client security & privacy |

### 1.4 Definitions

| Term | Meaning in this document |
|---|---|
| **Primary decision** | The deterministic output of `decideRebalance()` — `REBALANCE` or `HOLD`. This is the product's answer. |
| **Secondary signal** | The probability produced by the federated/global logistic-regression model, or by the rule fallback. It is explanatory only and never overrides the primary decision. |
| **Mandate** | The user's declared target allocation plus cash, horizon, risk preference and account type. |
| **Active weight** | `current weight − target weight` for a holding. |
| **No-trade band** | `min(absoluteBand, relativeBand × target)` — the tolerance before a holding is considered off-target. |
| **bps** | Basis points; 1 bp = 0.01%. |
| **Blocking state** | A condition under which the client MUST NOT display a live recommendation (unusable market data, missing mandate, unparseable file). |

---

## 2. Product context and the constraints it imposes on the UI

These are not background colour; each one generates hard UI requirements.

1. **The live decision is deterministic, not ML.** `decideRebalance()` in
   `lib/rebalanceEconomics.ts` produces the recommendation. The ML path is a
   secondary signal. → The UI must never attribute the verdict to "AI".
2. **Federated contributions are paused.** `FEDERATED_TRAINING_ENABLED = false`
   in `app/interact/InteractClient.tsx`, and the platform defaults
   `FEDERATED_CONTRIBUTIONS_ENABLED` / `FEDERATED_AGGREGATION_ENABLED` /
   `OUTCOME_BASED_MODEL_ENABLED` to `false`. → No screen may claim that the user
   is training a model or improving it for others.
3. **This is educational decision support, not advice.** Costs, taxes and prices
   are user-supplied estimates. → Disclosure requirements in §9 are mandatory,
   not decorative.
4. **Raw holdings never leave the browser.** Parsing, feature construction and
   the economics engine all run client-side. → The privacy claim is true and MAY
   be stated, but only in the precise form given in `CN-05`.
5. **Market data are bundled and can go stale.** The bundled `nifty50-15y.csv`
   is a fixed snapshot ending 2026-07-31 and is not refreshed on a schedule, so
   `assessMarketDataFreshness()` treats age past `MAX_MARKET_DATA_AGE_DAYS = 5`
   as `stale` rather than unusable; only an unreadable or under-90-row series
   fails closed. → The verdict must disclose the data age as a caveat, and the
   UI must still have a first-class "unavailable" state for the closed cases.
6. **The template is a fixed column contract.** `lib/portfolioParser.ts`
   requires exact headers (case-insensitive). It does not auto-map arbitrary
   broker exports. → Intake copy must not promise broker-format detection.

---

## 3. Users, goals and journeys

### 3.1 Personas

| Persona | Context | Primary goal | Sensitivity |
|---|---|---|---|
| **P1 — Retail investor with a written mandate** | Holds 10–40 Indian equities, knows their target allocation, reviews quarterly | "Am I far enough off target that trading is worth the cost and tax?" | Needs to trust the number; will act on the trade list |
| **P2 — Curious investor without a mandate** | Has holdings, no declared targets | Wants a recommendation | MUST be guided to declare targets, then blocked rather than given a fabricated answer |
| **P3 — Reviewer / examiner** | Evaluating the project (paper, viva, code review) | Wants to see the method, its assumptions and its limits | Needs the audit trail and the caveats to be visible, not buried |
| **P4 — Operator / admin** | Runs seeding and aggregation | Wants deterministic, side-effect-free administration | Must never trigger a state change by merely authenticating |

### 3.2 Primary journey (P1)

```
Landing → understand what this is and is not
      → Sign up / sign in (optional for the primary decision)
      → Download template
      → Fill in holdings + Target Weight %
      → Upload (drag-drop or picker)
      → Enter cash, horizon, risk preference, account type, last rebalance date
      → Run analysis
      → Read verdict → decision rationale → trade list → caveats
      → Export / act
```

- **GL-01 (MUST)** The primary journey MUST be completable in ≤ 6 interactions
  after the file is filled in: upload, four mandate fields, run.
- **GL-02 (MUST)** The primary journey MUST be completable **without an
  account**. Authentication only adds the secondary ML signal. Any screen
  implying sign-in is required for a recommendation is a defect.

---

## 4. Information architecture

| Route | Rendering | Auth | Purpose | Discoverable |
|---|---|---|---|---|
| `/` | Server component | Public | Positioning, honest capability summary, disclosure, entry point | Yes |
| `/auth` | Client component | Public | Sign in / sign up, tabbed | Yes |
| `/interact` | Client component | Public; auth-enhanced | The product: intake → analysis → result | Yes |
| `/train` | Client component | Admin secret | Seed and aggregate the global model | **No — unlisted** |
| `/not-found`, `/error` | Server/Client | Public | Recoverable failure states | N/A |

- **GL-03 (MUST)** `/train` MUST NOT be linked from any navigation, sitemap or
  footer, and MUST carry `robots: { index: false, follow: false }` metadata.
- **GL-04 (MUST)** Every route MUST define a unique, descriptive `<title>` and
  `description` via the Next.js Metadata API.
- **GL-05 (SHOULD)** A custom `not-found.tsx` and `error.tsx` SHOULD exist, each
  offering a route back to `/` and `/interact`.

---

## 5. Global requirements

### 5.1 Application shell

- **GL-06 (MUST)** All routes except `/auth` and `/train` MUST render a shared
  header containing the wordmark (linking to `/`) and the session control.
- **GL-07 (MUST)** The session control MUST reflect real state: `Sign In` when no
  token is present, and the account identity plus `Sign Out` when one is. It MUST
  be derived after hydration to avoid a server/client mismatch.
- **GL-08 (MUST)** The header, footer and page chrome MUST be implemented once as
  shared components. Duplicated per-page nav markup (current state) is a defect.
- **GL-09 (MUST)** A footer MUST appear on `/` and `/interact` carrying the
  disclosure of `CN-01`.

### 5.2 Theme and typography

- **GL-10 (MUST)** The product ships a **single dark theme**. `app/globals.css`
  MUST NOT declare a light-mode `prefers-color-scheme` variable set that no
  screen honours; either implement both themes fully or commit to one and set
  `color-scheme: dark` on `:root`.
- **GL-11 (MUST)** `body` MUST use the loaded `--font-geist-sans` variable. The
  current hardcoded `font-family: Arial, Helvetica, sans-serif` overrides the
  font the layout loads and MUST be removed.
- **GL-12 (MUST)** Colour, radius, spacing and typography MUST be expressed as
  Tailwind 4 theme tokens (§10) and referenced by name. New literal hex values
  (`bg-[#0a0a0f]`) in components are a defect.
- **GL-13 (SHOULD)** Fonts SHOULD be self-hosted rather than fetched from Google
  at build time. The production build is currently blocked in offline
  environments for exactly this reason (`rebuilding-plan.md`, §Validation status).

### 5.3 Session and error handling

- **GL-14 (MUST)** A rejected or expired token (`401`/`403` from the platform
  service) MUST clear the stored token, surface a non-blocking notice, and
  degrade to the unauthenticated path — never a blank screen or a silent retry.
- **GL-15 (MUST)** Every network call MUST have a visible outcome: success,
  typed failure, or "server unreachable". No call may fail silently.
- **GL-16 (MUST)** Any thrown exception in the analysis pipeline MUST be caught
  and rendered as a user-legible message with a recovery action. Raw
  `Error.message` MUST NOT be the whole of the user-facing text (current state).
- **GL-17 (SHOULD)** Client state SHOULD survive a route change within the
  session; a user returning from `/auth` to `/interact` SHOULD NOT have to
  re-enter mandate inputs.

---

## 6. Screen requirements

### 6.1 Landing page `/`

**Purpose:** tell the truth about what this tool does, and route the user into
it.

- **LP-01 (MUST)** The hero MUST state the actual value proposition: a
  deterministic, target-relative rebalancing estimate that weighs drift against
  cost and tax. It MUST NOT lead with "AI you can trust" or equivalent.
- **LP-02 (MUST)** Every feature claim on this page MUST correspond to shipped
  behaviour. Specifically, the following current claims MUST be removed or
  rewritten (see §21):
  - "Upload exports from Zerodha, Groww, Angel One, ICICI Direct… auto-maps
    columns regardless of broker format" — the parser requires the fixed
    template headers.
  - "The AI model trains locally on your device and only contributes anonymised
    weight updates" — local training is disabled and weight sharing is not
    anonymisation.
  - "The more users train the model, the smarter it gets for everyone" —
    aggregation is off by default.
  - "P&L at a glance", "unrealised gains", "top/bottom performers" — not
    computed or displayed anywhere.
  - "Your personal model weights are saved so retraining is fast" — no such flow.
- **LP-03 (MUST)** The "How it works" section MUST mirror the real pipeline:
  (1) declare targets and fill the template, (2) upload — parsing and the
  decision run in the browser, (3) read the verdict, trade list, costs and
  caveats.
- **LP-04 (MUST)** The disclosure of `CN-01` MUST appear above the fold or
  immediately below the hero — not only in the footer.
- **LP-05 (SHOULD)** The mock dashboard preview SHOULD either be replaced with a
  real rendering of a bundled fixture (`test-data/portfolio-1.csv`) or be
  labelled "Illustrative". Fabricated figures presented as product output are a
  disclosure defect.
- **LP-06 (MUST)** The primary CTA MUST route to `/interact`, not `/auth` — the
  product works without an account (`GL-02`). A secondary CTA MAY offer sign-in.
- **LP-07 (SHOULD)** A "What this tool does not do" section SHOULD list the
  known limits: no live quotes, no security-level covariance, no broker
  execution, no tax filing, estimates only.

### 6.2 Authentication `/auth`

- **AU-01 (MUST)** A single screen with a Sign In / Sign Up tab toggle; the
  default mode comes from the route's `defaultMode` prop.
- **AU-02 (MUST)** Fields — Sign Up: full name, email, password. Sign In: email,
  password. All with correct `autoComplete` tokens and `type`.
- **AU-03 (MUST)** Client-side validation MUST run before submission and report
  inline, per-field: email shape, password ≥ 8 characters on sign-up, name
  non-empty. The current single form-level error string is insufficient.
- **AU-04 (MUST)** Validation and server errors MUST be associated with their
  field via `aria-describedby` and announced via `role="alert"`.
- **AU-05 (MUST)** The submit button MUST show a busy state with accessible text
  ("Signing in…") and MUST be disabled while in flight to prevent double submit.
- **AU-06 (SHOULD)** A password visibility toggle SHOULD be provided, defaulting
  to hidden, with `aria-pressed`.
- **AU-07 (MUST)** On success, redirect to `/interact`, preserving any mandate
  state entered before the sign-in detour (`GL-17`).
- **AU-08 (MUST)** The copy MUST NOT promise "federated AI" as a user benefit
  (`CN-04`).
- **AU-09 (SHOULD)** Sign-up SHOULD show a password strength hint and MUST NOT
  block on rules the server does not enforce.

### 6.3 Analysis `/interact`

This is the product. It has four zones: **Intake**, **Mandate**, **Run**,
**Result**.

#### 6.3.1 Intake — template and upload

- **AN-01 (MUST)** Step 1 MUST offer the template download
  (`/templates/portfolio-template.xlsx`) and list the exact column contract:
  `Symbol · ISIN · Sector · Quantity · Average Buy Price · Current Price ·
  Target Weight % · Purchase Date`.
- **AN-02 (MUST)** Required vs optional columns MUST be visually distinguished.
  `ISIN` is optional; `Purchase Date` is optional but degrades the tax estimate;
  `Target Weight %` is **required for a live decision**.
- **AN-03 (MUST)** The drop zone MUST accept `.csv`, `.xlsx`, `.xls` by drag-drop
  **and** by click-to-browse, and MUST reject other extensions with a named
  reason before parsing.
- **AN-04 (MUST)** The drop zone MUST be a real control: focusable, activatable
  with Enter/Space, labelled, and with a visible focus ring. A `div` with only
  an `onClick` handler (current state) fails `AX-02`.
- **AN-05 (MUST)** After selection, the zone MUST show the file name, size, and a
  "Replace" affordance, and MUST clear any prior result and log.
- **AN-06 (SHOULD)** A parsed-file preview SHOULD show holding count, total
  portfolio value, and the sum of declared targets **before** the run, so the
  user can catch a bad file without executing the pipeline.
- **AN-07 (MUST)** Per-row parse errors MUST be reported with the row number and
  the reason, as produced by `parseCSV`/`parseExcel`, and MUST be visually
  separated from success messages.

#### 6.3.2 Mandate — configuration inputs

- **AN-08 (MUST)** The mandate form MUST collect exactly the inputs the engine
  consumes:

  | Field | Control | Default | Constraint | Consequence if wrong |
  |---|---|---|---|---|
  | Last rebalance date | `date`, max = today | empty → 0 days | past date only | feeds `days_since_last_rebalance` (feature 7) |
  | Available cash (₹) | `number` | `0` | finite, ≥ 0 | funds buy-side orders |
  | Horizon (days) | `number` | `365` | finite, > 0 | scales the risk benefit |
  | Risk preference | `number` or slider | `3` | 0–10, step 0.5 | scales the risk benefit |
  | Account type | `select` | `taxable` | `taxable` / `tax-advantaged` | switches tax estimation on/off |

- **AN-09 (MUST)** Each mandate field MUST be validated **before** `Run`, with
  an inline message. `decideRebalance()` throws on non-finite or out-of-range
  values; those throws MUST be unreachable from the UI. Today an empty Horizon
  field yields `NaN` and surfaces as "Unexpected error".
- **AN-10 (MUST)** `Run` MUST be disabled, with a stated reason, whenever a file
  is absent or any mandate field is invalid.
- **AN-11 (SHOULD)** Each field SHOULD carry a one-line explanation of what it
  changes in the result (a tooltip or helper text), since these are unfamiliar
  concepts for P2.
- **AN-12 (SHOULD)** Risk preference SHOULD be a slider with anchored labels
  ("tolerant → averse") rather than an unexplained 0–10 number.
- **AN-13 (MUST)** Currency inputs MUST accept plain digits, display an ₹ affix,
  and MUST NOT silently coerce an empty string to a meaningful value without
  showing the substituted default.

#### 6.3.3 Run — progress and audit trail

- **AN-14 (MUST)** The run MUST expose a step-wise progress trace covering:
  parse → target resolution → market-data load and freshness → portfolio
  features → market features → feature vector → decision → secondary model.
- **AN-15 (MUST)** Each trace entry MUST carry one of four statuses — info, ok,
  warn, error — encoded by **icon and text**, not colour alone (`AX-06`).
- **AN-16 (MUST)** The trace container MUST be an `aria-live="polite"` region so
  screen-reader users receive progress.
- **AN-17 (SHOULD)** The trace SHOULD be collapsible, collapsed by default once
  a result exists, and expanded automatically when the run ends in a blocking
  state. P3 needs it; P1 does not.
- **AN-18 (MUST)** The `Run` control MUST show a busy state and MUST be
  non-re-entrant for the duration of the run.
- **AN-19 (SHOULD)** The user SHOULD be able to abandon a run; the pipeline is
  fast but the TF.js import and CSV fetch are network-bound.

#### 6.3.4 Blocking states

- **AN-20 (MUST)** Each of the following MUST terminate the run in a **prominent
  blocking panel** — not merely a log line — stating the cause, the consequence
  ("a live recommendation is unavailable"), and the user's next action:

  | Condition | Source | Required message content |
  |---|---|---|
  | No valid holdings parsed | `parsePortfolioFile` | which columns/rows failed; link to re-download the template |
  | Missing header columns | `validateHeaders` | the exact missing column names |
  | Any holding without `Target Weight %` | `resolveTargetWeights` → `source: "missing"` | that a complete mandate is required, and why |
  | Targets sum ≤ 0 | `resolveTargetWeights` → `source: "invalid"` | that targets must total a positive number |
  | Market data unreadable or empty | `assessMarketDataFreshness` | that no prices could be read from the bundled source |
  | Fewer than 90 trading days | `assessMarketDataFreshness` | the row count and the 90-row requirement |
  | Insufficient history for features | `getLatestMarketFeatures` returns null | that risk features cannot be computed |

- **AN-21 (MUST)** In a blocking state the client MUST NOT render any verdict,
  trade list, or probability — including a stale one from a previous run.
- **AN-22 (MUST)** Target normalisation (targets summing to something other than
  100) MUST be surfaced as a **warning on the result**, not only in the trace:
  "Declared targets summed to X and were normalised to 100%."

#### 6.3.5 Result — verdict

- **AN-23 (MUST)** The verdict MUST be the deterministic `decision.action`,
  rendered as `REBALANCE` or `HOLD` with distinct colour **and** icon **and**
  wording.
- **AN-24 (MUST)** The verdict block MUST show, adjacent to the action:
  estimated net benefit (bps), implementation cost (bps), and tax (bps).
- **AN-25 (MUST)** The secondary ML signal MUST be visually and verbally
  subordinate, and MUST be labelled by provenance:
  - global model, real weights → "Secondary ML signal (global model)"
  - global model flagged `demo: true` → "Secondary ML signal (synthetic demo model)"
  - rule fallback → "Secondary signal unavailable — rule-based reference only"
  - not signed in → "Sign in to see the secondary model signal"
- **AN-26 (MUST)** The ML probability MUST be described as *model confidence*,
  never as probability of a good outcome or as investment certainty
  (`rebuilding-plan.md` P2 acceptance criteria).
- **AN-27 (MUST)** When the primary decision and the secondary signal disagree,
  the UI MUST say so explicitly and restate that the deterministic economics
  govern. Silent disagreement is a trust defect.

#### 6.3.6 Result — decision rationale

- **AN-28 (MUST)** Render `decision.reasons[0]` verbatim as the headline
  rationale, and any further reasons beneath it.
- **AN-29 (MUST)** Render every entry of `decision.caveats` — none may be
  truncated or collapsed by default. These include the estimate disclaimer, the
  volatility-proxy disclaimer, missing tax lots, non-executable trades, and the
  turnover cap.
- **AN-30 (MUST)** Show tracking-error proxy (%), turnover (%), and the cash
  reconciliation: opening cash → ending cash after trades, tax and costs.
- **AN-31 (SHOULD)** Provide a drift visualisation: per-holding current vs
  target weight with the no-trade band drawn, sorted by |active weight|. This is
  the single highest-value missing view — it answers "why" faster than any table.
- **AN-32 (SHOULD)** Where a band was breached but no trade was executable, the
  UI SHOULD name the binding constraint (minimum trade size, cash, or turnover
  cap) rather than only stating that none cleared.

#### 6.3.7 Result — trade list

- **AN-33 (MUST)** Render only trades where `tradeShares !== 0`, with columns:
  Holding, Current weight, Target weight, Order (Buy/Sell + share count),
  Estimated value (₹).
- **AN-34 (MUST)** Buy and sell orders MUST be distinguishable by text, not only
  by colour.
- **AN-35 (MUST)** The table MUST scroll horizontally within its own container
  on narrow viewports; the page body MUST NOT scroll horizontally (`RS-03`).
- **AN-36 (SHOULD)** Below `sm`, the table SHOULD collapse to one card per trade.
- **AN-37 (SHOULD)** The trade list SHOULD be exportable to CSV, and the whole
  result SHOULD be printable to a clean, single-column page — P1 acts on this
  outside the browser and P3 attaches it to a report.
- **AN-38 (MUST)** The trade list MUST be labelled as an estimate produced from
  user-entered prices, adjacent to the table, not only in the caveat list.
- **AN-39 (SHOULD)** A sum row SHOULD show total buy value, total sell value, and
  net cash effect, so the table reconciles visibly against `AN-30`.

#### 6.3.8 Result — diagnostics

- **AN-40 (MUST)** Condition groups (`evaluateConditions`) MUST render as a grid
  of triggered/untriggered chips with the description text.
- **AN-41 (MUST)** Portfolio statistics MUST render: holdings count, max weight,
  top-3 concentration, weight drift, portfolio return, volatility, sector
  concentration, days since last rebalance.
- **AN-42 (MUST)** `total_weight_drift` MUST be labelled as a **legacy
  equal-weight measure used only by the ML feature vector**, distinct from the
  target-relative active weights that drive the decision. Presenting it
  unqualified next to the decision (current state) invites the exact
  misinterpretation the rebuilding plan calls critical.
- **AN-43 (MUST)** Market conditions MUST render the benchmark name, 30d return,
  30d volatility, 90d drawdown, and trend, plus the **data date and provenance**
  from `MARKET_DATASET`.
- **AN-44 (SHOULD)** The raw 12-element feature vector SHOULD be available on
  demand (a disclosure/details element), not printed inline in the trace as an
  unformatted string.

### 6.4 Admin `/train`

- **AD-01 (MUST)** Authentication MUST be side-effect free. The current unlock
  probe POSTs to `/model/train`, which **runs a real FedAvg round** merely to
  validate the secret. This MUST be replaced with a dedicated read-only
  verification call.
- **AD-02 (MUST)** Two clearly separated actions: *Seed from `demo-dataset.csv`*
  and *Run FedAvg aggregation round*, each with its own description of what it
  changes.
- **AD-03 (MUST)** Every destructive or state-mutating action MUST require an
  explicit confirmation step naming the effect ("this activates a new global
  model version").
- **AD-04 (MUST)** Results MUST report: participants, global model serial number,
  timestamp, and model-service confirmation status, with `207` (partial) visually
  distinct from `200`.
- **AD-05 (MUST)** When `FEDERATED_AGGREGATION_ENABLED` or `DEMO_MODEL_ENABLED`
  is off, the corresponding action MUST be disabled with the reason shown, rather
  than failing at request time.
- **AD-06 (MUST)** The admin secret MUST be held in component state only, never
  written to `localStorage`, `sessionStorage`, the URL, or any log.
- **AD-07 (MUST)** The page MUST state that the seed dataset is synthetic and for
  compatibility/demo purposes only — it does not validate financial performance.
- **AD-08 (SHOULD)** A model history table (serial, timestamp, participants,
  versions, active flag) SHOULD be shown, with a rollback action per row, since
  `POST /model/rollback/:serialno` already exists and has no UI.
- **AD-09 (MUST)** The "not linked from anywhere, keep the URL private" footnote
  MUST meet contrast requirements (`text-zinc-700` on `#0a0a0f` does not).

---

## 7. Data and validation contract

### 7.1 Upload contract

- **DV-01 (MUST)** Accepted formats: `.csv`, `.xlsx`, `.xls`. Both comma- and
  tab-delimited CSV MUST parse (`test-data/portfolio_dual_decision.csv` is
  tab-separated by design).
- **DV-02 (MUST)** Header matching is case-insensitive and whitespace-trimmed.
  Required: `Symbol`, `Sector`, `Quantity`, `Average Buy Price`, `Current Price`.
- **DV-03 (MUST)** Accepted aliases MUST be documented in the UI:
  - Target weight: `Target Weight %`, `Target Weight`, `Target Allocation`,
    `Target Allocation %`
  - Purchase date: `Purchase Date`, `Buy Date`, `Acquisition Date`
- **DV-04 (MUST)** Row rejection reasons MUST be surfaced individually: empty
  symbol/sector, non-numeric quantity/prices, non-positive quantity/prices,
  negative target weight, future or malformed purchase date.
- **DV-05 (MUST)** Accepted date formats: `DD-MM-YYYY`, `DD/MM/YYYY`,
  `YYYY-MM-DD`. Future dates MUST be rejected with that reason.
- **DV-06 (SHOULD)** A file exceeding a documented size (suggested 5 MB) or row
  count (suggested 500 holdings) SHOULD be rejected with a clear message rather
  than freezing the main thread.
- **DV-07 (MUST)** No uploaded file, holding, price or target may be transmitted
  to any server, logged to an analytics endpoint, or persisted outside the tab.

### 7.2 Display formatting

- **DV-08 (MUST)** Currency: `en-IN` grouping with an `₹` prefix and no decimal
  places for values ≥ ₹1,000.
- **DV-09 (MUST)** Weights and returns: percentage with 1–2 decimals, sign
  always shown for changes.
- **DV-10 (MUST)** Cost/benefit figures: basis points with 1 decimal, suffixed
  `bps`, with a tooltip defining bps on first use per page.
- **DV-11 (MUST)** Dates: `DD MMM YYYY` for display; ISO in any exported file.
- **DV-12 (MUST)** No value derived from a floating-point computation may be
  rendered at more precision than its inputs justify — volatility at 5 decimals
  next to prices entered at 2 (current state) overstates precision.

---

## 8. Run state machine

- **AN-45 (MUST)** The analysis view MUST implement this state machine
  explicitly; states MUST NOT be inferred from a scatter of booleans.

```
idle ──file selected──> ready ──run──> running
                                        │
        ┌───────────────────────────────┼────────────────────────────┐
        ▼                               ▼                            ▼
    blocked(reason)                 complete(decision)          failed(error)
        │                               │                            │
        └──────── new file / edited mandate ──────────────────────> ready
```

| State | Verdict shown | Trace shown | Run enabled |
|---|---|---|---|
| `idle` | no | no | no |
| `ready` | no | previous run's, collapsed | yes |
| `running` | no | yes, live | no |
| `blocked` | **no** | yes, expanded, with blocking panel | yes |
| `complete` | yes | yes, collapsed | yes |
| `failed` | no | yes, expanded, with error panel | yes |

- **AN-46 (MUST)** Changing the file or any mandate field while a result is
  displayed MUST mark that result stale — either clear it or badge it "inputs
  changed, re-run to update". Showing a result that no longer matches the visible
  inputs is a correctness defect.

---

## 9. Content and disclosure requirements

- **CN-01 (MUST)** This disclosure MUST appear on `/` and `/interact`, and on any
  exported or printed result:
  > PortfolioIQ is an educational prototype. Its output is a deterministic
  > estimate based on the figures you provide. It is not investment, tax, or
  > broker execution advice.
- **CN-02 (MUST)** The words "prediction", "forecast", "guaranteed", "optimal"
  and "smart" MUST NOT describe the output. Use "estimate", "recommendation",
  "decision support".
- **CN-03 (MUST)** Any figure derived from user-entered prices MUST be labelled
  as an estimate at its point of display.
- **CN-04 (MUST)** Federated learning MUST NOT be presented as a user benefit
  while contributions are disabled. It MAY be described factually in a
  method/about section.
- **CN-05 (MUST)** The privacy claim MUST be stated in exactly this scope: raw
  holdings are parsed and analysed in the browser and are never transmitted;
  when contributions are enabled, only model coefficients would be uploaded, and
  that is data minimisation, **not** secure aggregation or anonymity.
- **CN-06 (MUST)** Error and warning copy MUST name the cause and the next
  action. "Something went wrong" is not acceptable text.
- **CN-07 (SHOULD)** Copy SHOULD use consistent terminology: *holding* (not
  stock/position/asset interchangeably), *target weight*, *drift*, *rebalance*,
  *no-trade band*.
- **CN-08 (SHOULD)** A `/method` or About section SHOULD document the decision
  rule, the 12 features, the cost/tax assumptions, and the data provenance — P3
  currently has to read the source.

---

## 10. Design system

### 10.1 Tokens

- **DS-01 (MUST)** Tokens MUST be declared once in `app/globals.css` under
  `@theme` and consumed by name everywhere.

The palette below is the Material-3 dark scheme carried by the Stitch designs
in `docs/stitch_screens/`, adopted 2026-08-08 when those designs were
implemented. It replaces the indigo/zinc set this table previously specified;
the roles are unchanged, only the values.

| Token | Value | Use |
|---|---|---|
| `--color-background` / `--color-surface` | `#13131b` | Page background |
| `--color-surface-container-low` | `#1b1b23` | Recessed panels, footer |
| `--color-surface-container` | `#1f1f27` | Cards, zones |
| `--color-surface-container-high` | `#292932` | Raised controls |
| `--color-surface-container-highest` | `#34343d` | Selected states, no-trade band |
| `--color-surface-bright` | `#393841` | Row hover |
| `--color-primary` | `#c0c1ff` | Brand, links, focus ring, BUY orders |
| `--color-on-primary` | `#1000a9` | Text on a filled primary surface |
| `--color-tertiary` | `#ffb783` | REBALANCE verdict, SELL orders, caveats |
| `--color-success` | `#6ddf9c` | HOLD verdict, positive confirmations |
| `--color-error` | `#ffb4ab` | Errors, blocking states, destructive actions |
| `--color-on-surface` | `#e4e1ed` | Headings, values |
| `--color-on-surface-variant` | `#c7c4d7` | Body, labels |
| `--color-outline` | `#908fa0` | Captions and hints (minimum permitted) |
| `--color-outline-variant` | `#464554` | Card and divider borders |

`--color-success` is not part of the generated Stitch config: no generated
screen shows the HOLD verdict, and the scheme contains no green. It is tuned to
the same tonal band as the palette it joins (relative luminance 0.584, against
primary 0.566 and tertiary 0.568) and measures 11.2:1 on the base surface.

- **DS-02 (MUST)** Text on any surface MUST meet `AX-04`. `--color-outline`
  (5.2:1 on `--color-surface-container`) is the darkest permitted text colour;
  `--color-outline-variant` is for borders only and MUST NOT carry text.
- **DS-03 (MUST)** Semantic colour meanings are fixed: `success` = hold/positive
  and BUY, `tertiary` = rebalance/sell and caveats, `error` = errors and blocking
  states. No screen may reuse them otherwise.
- **DS-04 (MUST)** Radius scale: `lg` (8px) controls, `xl` (12px) inner panels,
  `2xl` (16px) cards, modals and hero panels. Spacing on the named 4px grid
  (`xs` 4, `sm` 8, `md` 16, `lg` 24, `xl` 32, `2xl` 48). Note that these spacing
  names shadow Tailwind's container scale, so `max-w-md` resolves to 16px —
  width utilities MUST use an explicit value.
- **DS-05 (MUST)** Type scale, by token: `label-xs` (12/16/500) labels and
  captions, `body-sm` (14/20) body, `body-base` (16/24) emphasised body,
  `title-lg` (20/28/600) and `title-xl` (24/32/600) section and page titles,
  `verdict-lg` (36/44/700) and `verdict-xl` (48/56/700) hero and verdict only.

### 10.2 Component inventory

- **DS-06 (MUST)** These MUST exist as shared, typed components rather than
  repeated markup: `AppHeader`, `AppFooter`, `Card`, `SectionHeading`,
  `StatGrid`, `Button` (primary/secondary/danger/busy), `TextField`,
  `NumberField`, `SelectField`, `DateField`, `FileDropzone`, `Alert`
  (info/warn/error/blocking), `StatusList`, `Badge`, `DataTable`, `Disclosure`.
- **DS-07 (MUST)** Every interactive component MUST define and implement its
  full state set: default, hover, focus-visible, active, disabled, busy, error.
- **DS-08 (SHOULD)** Icons SHOULD come from one source. Mixed emoji and text
  glyphs (`⬆`, `📄`, `⚖`, `✓`, `⚙`) render inconsistently across platforms and
  are announced unpredictably by screen readers; where retained they MUST carry
  `aria-hidden="true"` with adjacent text.

---

## 11. Interaction and motion

- **DS-09 (MUST)** Transitions ≤ 200 ms for colour/opacity, ≤ 300 ms for layout.
- **DS-10 (MUST)** All motion MUST be suppressed under
  `prefers-reduced-motion: reduce`, including the hero pulse and the busy
  spinners (a static busy indicator replaces the spin).
- **DS-11 (MUST)** No layout shift when a result, alert or trace entry appears —
  reserve space or animate height from a known origin.
- **DS-12 (SHOULD)** When a run completes, focus SHOULD move to the verdict
  heading so keyboard and screen-reader users are taken to the answer.

---

## 12. Accessibility

Target: **WCAG 2.2 Level AA**.

- **AX-01 (MUST)** All content MUST be operable by keyboard alone, in a logical
  tab order, with a visible `focus-visible` ring meeting 3:1 contrast against the
  adjacent surface.
- **AX-02 (MUST)** No `div`/`span` may carry a click handler without an
  appropriate `role`, `tabIndex`, and key handlers. The upload dropzone is the
  current violation.
- **AX-03 (MUST)** Every input MUST have a programmatically associated `<label>`.
  Placeholder text MUST NOT serve as the label.
- **AX-04 (MUST)** Text contrast ≥ 4.5:1 (≥ 3:1 for text ≥ 24px or bold ≥ 19px);
  UI component and graphical boundaries ≥ 3:1.
- **AX-05 (MUST)** Error messages MUST use `role="alert"` and be referenced by
  `aria-describedby` from their field.
- **AX-06 (MUST)** No information may be conveyed by colour alone — verdict,
  trade direction, trace status and condition triggers all MUST carry a text or
  shape cue.
- **AX-07 (MUST)** The activity trace MUST be an `aria-live="polite"` region;
  blocking errors MUST be `aria-live="assertive"`.
- **AX-08 (MUST)** Tables MUST use `<th scope>` headers and a `<caption>` or
  `aria-labelledby` naming the table.
- **AX-09 (MUST)** Heading levels MUST be sequential; each route has exactly one
  `<h1>`.
- **AX-10 (MUST)** A "Skip to content" link MUST be the first focusable element
  on routes with a header.
- **AX-11 (MUST)** Touch targets ≥ 24×24 CSS px (WCAG 2.2 target size, minimum),
  ≥ 44×44 for primary actions.
- **AX-12 (MUST)** The page MUST remain usable at 200% zoom and at 320px width
  without loss of content or function.
- **AX-13 (SHOULD)** Automated checks (axe-core) SHOULD run in CI on all four
  routes with zero serious/critical violations as the merge gate.

---

## 13. Responsive layout

- **RS-01 (MUST)** Breakpoints: base (< 640px), `sm` 640, `md` 768, `lg` 1024,
  `xl` 1280. Content column max-width 1280px on `/`, 1024px on `/interact`.
- **RS-02 (MUST)** Supported range: 320px to 2560px wide.
- **RS-03 (MUST)** The document MUST never scroll horizontally. Wide content
  (trade table, feature vector, code-like strings) MUST scroll inside its own
  `overflow-x: auto` container.
- **RS-04 (MUST)** Below `md`, the intake and mandate columns stack in the order
  template → upload → mandate → run.
- **RS-05 (MUST)** Stat grids: 4 columns at `sm+`, 2 columns below.
- **RS-06 (SHOULD)** The verdict block SHOULD remain visible or reachable in one
  action while scrolling a long result on mobile.

---

## 14. Performance

- **PF-01 (MUST)** `/` and `/auth` MUST NOT include TensorFlow.js in their
  initial bundle. TF.js MUST remain dynamically imported at the point of use
  (current behaviour — preserve it).
- **PF-02 (MUST)** `@tensorflow/tfjs-node` MUST NOT reach the browser bundle. It
  is currently a runtime dependency of the client package and MUST be moved to
  dev/test-only usage or verified excluded.
- **PF-03 (SHOULD)** Initial JS transferred: ≤ 200 KB gzipped for `/` and
  `/auth`; ≤ 350 KB for `/interact` before the dynamic model import.
- **PF-04 (SHOULD)** Targets on a mid-range mobile device over 4G: LCP ≤ 2.5 s,
  INP ≤ 200 ms, CLS ≤ 0.1.
- **PF-05 (MUST)** The 3,700-row market CSV fetch MUST NOT block first paint; it
  is fetched only during a run (current behaviour — preserve it).
- **PF-06 (SHOULD)** Parsing and feature computation for a 100-holding portfolio
  SHOULD complete within 1 s; anything longer SHOULD move off the main thread
  into a worker to keep the UI responsive.
- **PF-07 (SHOULD)** The market CSV SHOULD be cached for the session so repeated
  runs do not refetch it.

---

## 15. Client security and privacy

- **SC-01 (MUST)** The JWT MUST NOT be readable by injected script if it can be
  avoided; the target design is an `httpOnly` cookie set by the platform service.
  While `localStorage` is used, this MUST be recorded as an accepted risk with a
  migration owner.
- **SC-02 (MUST)** No portfolio data, file content, or derived holding-level
  figure may be written to `localStorage`, `sessionStorage`, IndexedDB, or any
  telemetry sink.
- **SC-03 (MUST)** The admin secret MUST live only in volatile component state
  (`AD-06`).
- **SC-04 (MUST)** All external content MUST be treated as untrusted; no
  `dangerouslySetInnerHTML` anywhere in the client.
- **SC-05 (SHOULD)** A Content-Security-Policy SHOULD be set via Next.js headers,
  disallowing inline script and restricting `connect-src` to
  `NEXT_PUBLIC_API_URL`.
- **SC-06 (MUST)** Sign-out MUST clear all client-held session state, not only
  the token key.

---

## 16. Localisation and formatting

- **LN-01 (MUST)** Locale: `en-IN`. Currency `INR`. All number and date
  formatting MUST go through a shared formatting module, not ad-hoc
  `toLocaleString` calls at call sites.
- **LN-02 (SHOULD)** Copy SHOULD be authored so that a future translation layer
  can be introduced without restructuring components (no string concatenation
  across JSX boundaries).
- **LN-03 (MUST)** Tax terminology MUST match the modelled Indian regime
  (short-term / long-term capital gains, the long-term exemption) and MUST state
  the rates used, because they are policy constants in
  `DEFAULT_REBALANCE_POLICY`, not live tax law.

---

## 17. Browser support

- **NFR-01 (MUST)** Latest two major versions of Chrome, Edge, Firefox and
  Safari, desktop and mobile.
- **NFR-02 (MUST)** No dependency on a File System Access API or other
  non-universal capability for the primary journey.
- **NFR-03 (SHOULD)** With JavaScript disabled, `/` SHOULD still render its
  content and disclosure (it is a server component today — preserve that).

---

## 18. Instrumentation

- **NFR-04 (MUST)** If analytics are ever added, they MUST be opt-in, MUST NOT
  transmit any portfolio-derived value, and MUST be documented in the privacy
  copy. Until then, the client ships with no third-party trackers.

---

## 19. Acceptance criteria and test matrix

### 19.1 Release gates

A release is acceptable when all of the following hold.

| # | Gate | Verified by |
|---|---|---|
| G1 | Every MUST in §5–§16 is implemented or has a recorded, dated waiver | Review checklist |
| G2 | axe-core reports zero serious/critical issues on all four routes | CI |
| G3 | The primary journey is completable by keyboard only, and with a screen reader | Manual script |
| G4 | No landing-page claim lacks a corresponding shipped behaviour | Copy review against §6.1 |
| G5 | Each blocking state in `AN-20` renders its panel and suppresses the verdict | Component tests |
| G6 | The four `test-data` fixtures produce the decisions documented in `test-data/README.md` through the UI | E2E |
| G7 | No horizontal page scroll at 320px on any route | Visual test |
| G8 | Production build succeeds offline | CI |

### 19.2 Fixture-driven E2E matrix

Fixtures already exist and are hand-checked; the UI tests MUST use them.

| Fixture | Mandate inputs | Expected UI outcome |
|---|---|---|
| `portfolio-0.csv` | 10 days since rebalance | Verdict **HOLD**; rationale "All positions remain inside their target-relative no-trade bands"; no trade table rendered |
| `portfolio-1.csv` | 95 days since rebalance | Verdict **REBALANCE**; trade table present; tax 0 bps; cash reconciliation balances |
| `portfolio-1-0.csv` | per fixture README | Verdict **HOLD**; caveat naming the unexecutable-trade constraint; no trade table |
| `portfolio_dual_decision.csv` | per fixture README | Parses despite tab delimiters; decision follows net benefit; either verdict renders correctly |
| Template with a blank `Target Weight %` | any | **Blocked**: missing-mandate panel; no verdict |
| Template missing `Current Price` header | any | **Blocked**: named missing column; no verdict |
| Any valid file, market CSV stubbed to 2026-01-01 | any | Verdict renders; trace warns on the data age and the caveats quote the price date and age |
| Any valid file, market CSV truncated below 90 rows | any | **Blocked**: unavailable panel quoting the row count and the 90-row minimum |
| Any valid file, horizon field cleared | — | `Run` disabled with an inline reason; no exception surfaces |

### 19.3 Unit/component coverage required

- **NFR-05 (MUST)** Component tests MUST cover: dropzone keyboard activation,
  mandate validation boundaries (0 cash, 0 horizon, risk 0 and 10), the state
  machine transitions of §8, and the stale-result badge of `AN-46`.

---

## 20. Out of scope

Explicitly not required by this specification:

1. Live or streaming price quotes; broker API integration; order placement.
2. Multi-portfolio management, saved portfolios, or historical run comparison.
3. Security-level covariance, factor exposure, or return forecasting views.
4. A user-facing federated-learning dashboard or contribution history.
5. Light theme (until `GL-10` is resolved in its favour).
6. Native mobile applications; offline PWA behaviour.
7. Any onward sharing, emailing or hosting of a user's portfolio data.

---

## 21. Gap register — current implementation vs this specification

Findings from reading `app/`, `components/` and `lib/` on branch
`rebuild-codex`. Severity: **C** = blocks release, **H** = materially misleading
or inaccessible, **M** = quality.

> **Status, 2026-08-08.** This register predates the Stitch design
> implementation. Gaps 1–15, 17–20, 22 and 23 are closed by that work. Two
> remain open:
>
> - **16 (partial)** — CSV export and a print stylesheet now exist; there is no
>   PDF report. Open question §23.5 still applies.
> - **21 (partial)** — `GL-14` is implemented (a 401/403 clears the token and the
>   UI degrades), but the JWT still lives in `localStorage`. `SC-01` stands as an
>   accepted risk pending open question §23.3.
>
> Also still open: **`GL-17`** — mandate inputs do not survive a route change, so
> a sign-in detour mid-analysis loses them. The uploaded `File` cannot be
> persisted across navigation and `SC-02` restricts what may be written to
> storage, so this needs a decision rather than a patch.

| # | Gap | Location | Req | Sev |
|---|---|---|---|---|
| 1 | Landing page claims broker-format auto-mapping, local AI training, collaborative model improvement, P&L views and saved weights — none of which ship | `app/page.tsx:118–159, 167–192` | LP-02, LP-03, CN-04 | **C** |
| 2 | No disclaimer anywhere on `/` or in the footer, despite the product being an educational prototype | `app/page.tsx:196–223` | CN-01, LP-04 | **C** |
| 3 | Admin "Authenticate & Train" validates the secret by executing a real FedAvg round | `app/train/TrainClient.tsx:33–65` | AD-01 | **C** |
| 4 | Blocking states (stale data, missing targets, bad headers) appear only as log lines; no blocking panel, and `setRunning(false)` is skipped on two early returns | `app/interact/InteractClient.tsx:136–156, 170–174` | AN-20, AN-21 | **C** |
| 5 | Upload dropzone is a `div` with `onClick` — not focusable, no role, no keyboard activation | `app/interact/InteractClient.tsx:470–502` | AX-02, AN-04 | **C** |
| 6 | Mandate fields are unvalidated; a cleared Horizon yields `NaN`, `decideRebalance` throws, and the user sees "Unexpected error" | `app/interact/InteractClient.tsx:187–197, 403–405` | AN-09, GL-16 | **H** |
| 7 | Hero mock dashboard presents fabricated figures (₹4,82,310, "Rebalance Score 74/100") as product output, unlabelled | `app/page.tsx:63–108` | LP-05 | **H** |
| 8 | `total_weight_drift` shown in Portfolio Stats without the legacy/equal-weight qualification, next to a target-relative decision | `app/interact/InteractClient.tsx:729` | AN-42 | **H** |
| 9 | Text at `zinc-600`/`zinc-700` on `#0a0a0f` fails contrast | `InteractClient.tsx:591`, `TrainClient.tsx:247` | DS-02, AX-04 | **H** |
| 10 | Activity log is not a live region; run progress is invisible to screen readers | `app/interact/InteractClient.tsx:598–624` | AX-07, AN-16 | **H** |
| 11 | Auth errors are a single form-level string with no field association | `components/AuthForm.tsx:171–175` | AU-03, AU-04 | **H** |
| 12 | `globals.css` declares a light-mode variable set that no screen honours, and `font-family: Arial` overrides the loaded Geist font | `app/globals.css:5–8, 21–26` | GL-10, GL-11 | **H** |
| 13 | Results are not invalidated when inputs change after a run | `app/interact/InteractClient.tsx:390–401` | AN-46 | **H** |
| 14 | No shared component or token layer; nav, cards, buttons and inputs are re-declared per file with literal hex/zinc values | all of `app/` | GL-08, GL-12, DS-01, DS-06 | **M** |
| 15 | No drift visualisation — the strongest available explanation of the verdict is absent | — | AN-31 | **M** |
| 16 | No export or print path for the trade list or result | — | AN-37 | **M** |
| 17 | Raw feature vector printed as an unformatted string in the log | `app/interact/InteractClient.tsx:202–209` | AN-44, DV-12 | **M** |
| 18 | `@tensorflow/tfjs-node` is a runtime dependency of the client package | `package.json` | PF-02 | **M** |
| 19 | No `not-found` or `error` boundary routes | — | GL-05 | **M** |
| 20 | Model rollback and history have API support but no UI | — | AD-08 | **M** |
| 21 | JWT stored in `localStorage`; no expiry handling on 401 | `AuthForm.tsx:55`, `InteractClient.tsx:90–92` | SC-01, GL-14 | **M** |
| 22 | Emoji used as functional icons without `aria-hidden` or text equivalents | `page.tsx:118–148`, `InteractClient.tsx:490` | DS-08, AX-06 | **M** |
| 23 | `/train` lacks `noindex` metadata despite being unlisted | `app/train/page.tsx` | GL-03 | **M** |

---

## 22. Traceability to `rebuilding-plan.md`

| Plan item | Frontend requirements that satisfy it |
|---|---|
| P0.6 — correct admin UI and documentation text | AD-02, AD-07, LP-02, CN-04 |
| P1.1 — extend intake with targets, cash, account type, horizon, risk, constraints | AN-01, AN-02, AN-08 |
| P1.3 — distinguish estimates from verified calculations | CN-03, AN-29, AN-38, DV-12 |
| P1.4 — explicit unavailable/stale state | AN-20, AN-21, AN-43 |
| P1 acceptance — "UI shows benefit, cost, tax, uncertainty and reason" | AN-24, AN-28, AN-29, AN-30 |
| P1 acceptance — "every trade list reconciles to cash and target weights" | AN-30, AN-39 |
| P1 acceptance — "unusable prices block a live recommendation; stale prices are disclosed" | AN-20, AN-21, AN-29 |
| P2 acceptance — "confidence is model confidence, not investment certainty" | AN-25, AN-26, AN-27 |
| P3.2 — rollback and audit visibility for operators | AD-04, AD-08 |
| Design rule — "present as educational decision support" | CN-01, CN-02, LP-01, LP-07 |

---

## 23. Open questions

1. **Theme direction** — commit to dark-only (simplest, matches every existing
   screen) or implement both properly? `GL-10` is blocked on this.
2. **Auth posture** — is `/interact` intended to stay usable anonymously? This
   specification assumes yes (`GL-02`); if not, `LP-06` and the whole entry flow
   change.
3. **Cookie migration** — is moving the JWT to an `httpOnly` cookie in scope for
   this cycle, or does `SC-01` stand as an accepted risk?
4. **Market data governance** — *resolved for this cycle*: the CSV stays a
   bundled snapshot with no refresh schedule, so age past the five-day target is
   the normal state. It is therefore disclosed as a verdict caveat and a trace
   warning rather than blocking the run under `AN-20`. Revisit if a governed
   feed lands, at which point age should fail closed again.
5. **Export format** — CSV only, or a PDF/print report for P3? Affects `AN-37`.
6. **Result history** — is a per-user record of past analyses wanted? It is
   currently out of scope (§20.2) and would change the privacy claim in `CN-05`.
