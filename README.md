# PortfolioIQ

PortfolioIQ is an educational portfolio rebalancing prototype. Its live decision is a deterministic, target-relative economics estimate; it is not investment, tax, or broker execution advice. The optional federated model is currently paused until outcome-based labels are available.

The bundled `apps/model-service/demo-dataset.csv` is a 30,000-row **synthetic**
classification dataset for the accompanying paper/demo. Its reproducible
random-split metrics demonstrate software behaviour only; they are not evidence
of real-market performance or portfolio suitability.

---

## How It Works

1. **Upload** holdings with a target weight for every holding and optional purchase dates.
2. **Provide** available cash, investment horizon, risk preference, and account type.
3. **Validate** the bundled NIFTY 50 market-data freshness and provenance; stale or missing data blocks a live recommendation.
4. **Estimate** target-relative drift, costs, tax, no-trade bands, and an executable whole-share trade list.
5. **Show** a hold/rebalance decision, uncertainty caveats, and a cash reconciliation.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Browser (Next.js)                                      │
│  Portfolio + target mandate + constraints                │
│  → deterministic rebalancing economics                  │
└────────────────────┬────────────────────────────────────┘
                     │ REST (JWT)
┌────────────────────▼────────────────────────────────────┐
│  Platform Service (Express + Node.js :5000)             │
│  Auth · User weight storage · FedAvg aggregation        │
│  globalModelHistory · userModelHistory (Postgres)       │
└────────────────────┬────────────────────────────────────┘
                     │ REST (internal)
┌────────────────────▼────────────────────────────────────┐
│  Model Service (FastAPI + scikit-learn :8000)           │
│  /train/dataset · /weights (get/set)                    │
└─────────────────────────────────────────────────────────┘
```

### Model-state flow

```
The platform keeps versioned model snapshots and accepts only finite,
12-feature, contract-compatible weights. Aggregation and model seeding require
the server-side `x-admin-secret`; model-service endpoints require the separate
`MODEL_SERVICE_SECRET`. Client-side federated contributions are intentionally
disabled until P2 supplies forward, net-of-cost outcome labels. The platform
defaults `OUTCOME_BASED_MODEL_ENABLED`, `FEDERATED_CONTRIBUTIONS_ENABLED`, and
`FEDERATED_AGGREGATION_ENABLED` to `false`; setting them to `true` is a
production-promotion decision after validation, not a normal setup step.
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS 4 |
| In-browser ML | TensorFlow.js 4.22 (logistic regression) |
| File parsing | PapaParse (CSV), XLSX (Excel) |
| Backend | Express 5, Node.js, TypeScript |
| ORM | Drizzle ORM + Drizzle Kit |
| Database | PostgreSQL 17 (Docker) |
| ML service | FastAPI, scikit-learn, pandas, NumPy |
| ML server | Uvicorn |
| Monorepo | Turborepo + npm workspaces |
| Auth | JWT (jsonwebtoken) + bcryptjs |

---

## Project Structure

```
.
├── apps/
│   ├── react-client/               # Next.js frontend
│   │   ├── app/
│   │   │   ├── page.tsx            # Landing page
│   │   │   ├── auth/               # Sign in / Sign up
│   │   │   ├── interact/           # Portfolio upload & prediction
│   │   │   └── train/              # Admin: seed model & run FedAvg
│   │   ├── lib/
│   │   │   ├── rebalanceEconomics.ts   # Target-relative decision engine (live path)
│   │   │   ├── featureEngineering.ts   # 12-feature vector + legacy labeling function
│   │   │   ├── portfolioParser.ts      # CSV / Excel parser + target mandate
│   │   │   ├── marketData.ts           # NIFTY 50 parsing, features, freshness policy
│   │   │   ├── rebalanceEconomics.test.ts  # Financial decision tests
│   │   │   └── modelParity.test.ts     # TS half of the cross-runtime parity contract
│   │   ├── ts-model/
│   │   │   └── logisticRegression.ts   # TF.js logistic regression (sklearn API)
│   │   └── public/dataset/
│   │       └── nifty50-15y.csv         # Daily NIFTY 50, 2011-08-01 onward
│   │
│   ├── platform-service/           # Express backend
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── auth.router.ts      # /auth/signup, /auth/signin
│   │   │   │   ├── client.router.ts    # Model weight endpoints
│   │   │   │   └── model.route.ts      # Aggregate, seed, train, rollback
│   │   │   ├── federated.ts            # Aggregation core: validation, FedAvg, round lock
│   │   │   ├── weight-validation.ts    # Upload contract + per-account throttle
│   │   │   ├── model-contract.ts       # Feature/scaler/model version gate
│   │   │   ├── queries/
│   │   │   └── middleware/
│   │   └── tests/                      # API, aggregation, migration, end-to-end tests
│   │
│   └── model-service/              # FastAPI ML service
│       ├── app/
│       │   ├── main.py             # Endpoints
│       │   └── model.py            # GlobalModel (sklearn wrapper)
│       ├── tests/                  # Contract + Python half of the parity tests
│       └── demo-dataset.csv        # Synthetic demo dataset (30,000 rows)
│
└── packages/
    ├── model-contract/             # Generated, shared across TypeScript and Python
    │   ├── feature-spec.json       # Feature order, scaler, and contract versions
    │   └── parity-fixtures.json    # Known vectors both runtimes must reproduce
    └── database/                   # Shared Drizzle schema + Docker Compose
        └── src/
            └── schema.ts
```

---

## Feature Engineering

Each prediction is built from a **12-dimensional feature vector**:

| # | Feature | Description |
|---|---------|-------------|
| 0 | `num_stocks` | Number of holdings |
| 1 | `max_stock_weight` | Largest single holding weight |
| 2 | `top3_concentration` | Sum of 3 largest weights |
| 3 | `total_weight_drift` | Legacy ML feature; the live decision uses target-relative active weights instead |
| 4 | `portfolio_return` | Σ Wᵢ × Rᵢ |
| 5 | `portfolio_volatility` | Σ Wᵢ × (Rᵢ − Rₚ)² |
| 6 | `sector_concentration` | Max sector weight sum |
| 7 | `days_since_last_rebalance` | User-provided |
| 8 | `market_return_30d` | NIFTY 50 30-day return |
| 9 | `market_volatility_30d` | NIFTY 50 30-day volatility |
| 10 | `market_drawdown_90d` | NIFTY 50 90-day drawdown |
| 11 | `market_trend` | MA20 > MA50 → 1 (bullish), else 0 |

### Model labels (not a live decision rule)

The bundled model dataset still uses a historical heuristic and is not a source
of economic truth. It is retained only for protected contract and compatibility
work while P2 replaces it with outcome-based labels.

```
t_score = 2.5 × (2 / (1 + exp(-(days - 60) / 40)) - 1)
          a bounded logistic in (-2.5, +2.5), centred at 60 days

delta   = adjustments from drift, concentration,
          sector exposure, market drawdown, trend,
          volatility (clamped to [-2.5, +2.5])

score   = clamp(t_score, ±2.5) + clamp(delta, ±2.5)
prob    = sigmoid(score)
label   = 1 (Rebalance) if prob ≥ 0.5, else 0 (Hold)
```

Both terms share the same ±2.5 range deliberately. The earlier bracketed time
score ran to ±5.0 while `delta` was capped at ±2.5, so elapsed days alone could
veto every other signal and the model degenerated into reading
`days_since_last_rebalance` back to itself.

---

## Database Schema

```
users
  userid · username · email · password

usermodelhistory
  serialno · userid (FK) · coeff · intercept · n_samples
  feature_version · scaler_version · model_version · validation_auc · timestamp

globalmodelhistory
  serialno · coeff · intercept · participants · n_samples_total
  feature_version · scaler_version · model_version · timestamp
```

---

## API Reference

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/signup` | Register |
| POST | `/auth/signin` | Login → returns JWT |

### Client (requires `token` header)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/client/model/global` | Latest global model weights |
| POST | `/client/model/weights` | Upload locally trained weights |
| GET | `/client/model/weights` | User's last uploaded weights |
| GET | `/client/model/history` | Paginated weight history |

### Admin (requires `x-admin-secret` header)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/model/seed` | Train global model on `demo-dataset.csv` |
| POST | `/model/aggregate` | Run protected sample-weighted FedAvg |
| POST | `/model/train` | Backward-compatible protected FedAvg route |
| POST | `/model/rollback/:serialno` | Restore a recorded snapshot, appending to history |

### Model Service (internal, port 8000)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/train/dataset` | Train on the bundled demo dataset, returning a held-out evaluation |
| POST | `/train` | Train on supplied raw observations; standardized exactly once server-side |
| GET | `/weights` | Get current weights |
| POST | `/weights` | Set weights |

All model-service endpoints require the internal `x-model-service-secret`
header, and the two training routes additionally require `DEMO_MODEL_ENABLED`.

---

## Getting Started

### Prerequisites

- Node.js 18+, npm 11.8.0
- Python 3.11 + virtualenv
- Docker & Docker Compose

### 1. Clone & install

```bash
git clone https://github.com/CSVaishakh/PortfolioRebalancing
cd PortfolioRebalancing
npm install
```

### 2. Environment variables

`.env` files are **not** tracked in git. Copy each example and fill in your own
secrets:

```bash
cp apps/platform-service/.env.example apps/platform-service/.env
cp apps/model-service/.env.example    apps/model-service/.env
cp packages/database/.env.example     packages/database/.env
```

**`apps/platform-service/.env`**
```env
PORT=5000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portfolio_rebalancing
JWT_SECRET=your-secret-here
JWT_EXPIRES_IN=7d
MODEL_SERVICE_URL=http://localhost:8000
ADMIN_SECRET=your-admin-secret
MODEL_SERVICE_SECRET=a-different-internal-service-secret
FEDERATED_CONTRIBUTIONS_ENABLED=false
FEDERATED_AGGREGATION_ENABLED=false
OUTCOME_BASED_MODEL_ENABLED=false
DEMO_MODEL_ENABLED=true
```

**`apps/react-client/.env`**
```env
PORT=3000
NEXT_PUBLIC_API_URL=http://localhost:5000
```

**`apps/model-service/.env`**
```env
PORT=8000
MODEL_SERVICE_SECRET=a-different-internal-service-secret
DEMO_MODEL_ENABLED=true
```

`ADMIN_SECRET` and `MODEL_SERVICE_SECRET` are required — both services refuse to
start without them, so a misconfigured deployment fails loudly rather than
serving unprotected model endpoints. `MODEL_SERVICE_SECRET` must be identical in
the platform and model services. The three feature flags default to `false`;
turning them on is a production-promotion decision, not a setup step.

### 3. Set up Python environment

```bash
cd apps/model-service
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 4. Start everything

```bash
npm run dev
```

This starts the database, platform service (:5000), React client (:3000), and model service (:8000) concurrently.

### 5. Seed the global model

Navigate to `/train` in the browser, enter your `ADMIN_SECRET`, and click **Seed from demo-dataset.csv** only for model-service compatibility testing. It does not enable the paused federated contribution path or replace the economics decision.

---

## NPM Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start all services + database |
| `npm run build` | Build all packages via Turbo |
| `npm test` | Run every package's test suite via Turbo |
| `npm run db:start` | Start PostgreSQL container |
| `npm run db:stop` | Stop PostgreSQL container |
| `npm run db:push` | Push Drizzle schema to database |
| `npm run db:studio` | Open Drizzle Studio (DB GUI) |
| `npm run db:shell` | Open psql shell |
| `npm run db:clear` | Truncate all tables, reset sequences |
| `npm run db:clear:weights` | Truncate model tables only (keep users) |
| `npm run db:reset` | Destroy volume, recreate and push schema |

---

## Testing

```bash
npm test                                  # every package, via Turbo
npm test --workspace apps/react-client    # financial decision + parity tests
npm test --workspace apps/platform-service # API, aggregation, migration, end-to-end
cd apps/model-service && source .venv/bin/activate && npm test
```

| Area | Location | What it covers |
|------|----------|----------------|
| Scaler & prediction parity | `apps/react-client/lib/modelParity.test.ts`, `apps/model-service/tests/test_parity.py` | Both runtimes reproduce the same standardized vectors, logits and probabilities from `packages/model-contract/parity-fixtures.json` |
| Financial decisions | `apps/react-client/lib/rebalanceEconomics.test.ts` | Target-relative drift, no-trade bands, taxes, transaction costs, cash reconciliation, turnover caps, stale data, missing mandate inputs |
| API contract | `apps/platform-service/tests/api.test.ts` | Authentication, admin authorization, malformed and non-finite payloads, invalid feature/model versions, invalid sample counts, rate limiting, feature flags |
| Aggregation | `apps/platform-service/tests/federated.test.ts` | Deterministic sample-weighted FedAvg, influence clipping, round locking, model-service failure and retry |
| Upload boundaries | `apps/platform-service/tests/weight-validation.test.ts` | Exact limits of the upload contract and the per-account throttle |
| End-to-end workflow | `apps/platform-service/tests/e2e-workflow.test.ts` | Seed → two eligible clients contribute → aggregate → activate a versioned global model → client retrieves compatible weights → rollback |
| Database migration | `apps/platform-service/tests/migration.test.ts` | Migrating a populated pre-`n_samples` database, checking defaults and data survival |

The migration test needs a reachable PostgreSQL and **skips** (it does not pass)
when there is none. To run it:

```bash
npm run db:start
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/portfolio_rebalancing \
  npm test --workspace apps/platform-service
```

It works inside a throwaway `migration_test_pre_n_samples` schema that it drops
afterwards, so it does not disturb development data.

### Model-state integrity

Aggregation hands weights to the model service **before** recording the
snapshot, and retries a transient failure. If the model service never confirms,
no global model is activated — the database can never advertise an active model
the inference service does not hold. A round lock rejects a concurrent
aggregation request rather than queueing it, so two rounds cannot each read the
same participant set and write competing "latest" snapshots.

---

## Portfolio Template

Download the template from the `/interact` page. Required columns:

| Column | Description |
|--------|-------------|
| Symbol | Stock ticker (e.g. RELIANCE) |
| ISIN | ISIN code |
| Sector | Sector name |
| Quantity | Number of shares held |
| Average Buy Price | Your average purchase price |
| Current Price | Current market price |

---

## Privacy Model

- Raw portfolio data **never leaves the browser**. The rebalancing decision is
  computed locally and no holdings, prices, or targets are transmitted.
- When federated contributions are enabled, only linear-model coefficients are
  uploaded — never rows.
- **This is not secure aggregation.** Sharing ordinary model weights carries no
  formal privacy guarantee: the server sees each participant's update in the
  clear, and model updates can leak information about the data that produced
  them. Treat the current design as data minimisation, not anonymity. Secure
  aggregation or differential privacy would each be a separate piece of work.
- Federated contributions are **disabled by default**
  (`FEDERATED_CONTRIBUTIONS_ENABLED=false`) and the live recommendation does not
  depend on them. The global model changes only when an operator runs an
  aggregation round, not automatically with each user.
