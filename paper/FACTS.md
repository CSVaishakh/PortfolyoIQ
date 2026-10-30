# FACTS.md — the single numeric contract for the PortfolioIQ IEEE paper

**Every agent MUST take numbers from this file only.** Do not re-derive, re-round, or
invent. If a quantity is not here, it does not go in the paper (or it is marked
"not measured" / future work).

All values below were **re-executed on 2026-08-05** by `paper/scripts/reproduce.py`
under the repository's pinned environment (scikit-learn 1.7.2, numpy 2.2.6,
pandas 2.3.3) against the committed data. Raw output: `paper/figures/results.json`.

---

## 0. Title, framing, hard rules

**Title**: *Federated Learning-Based Portfolio Rebalancing Necessity Detection*

**Author decision (2026-08-05).** The author has chosen this title and directed that
federated learning and rebalancing-necessity detection carry **equal weight** in the
Methodology, because both are equal parts of the system as built. The paper is
therefore a **system and methodology** paper: federation is presented as a designed,
implemented and unit-tested contribution, NOT as an empirical result.

This is compatible with honesty on one mandatory condition: **exactly one clear
statement** in the Methodology must say the aggregation path is disabled by default
and not experimentally evaluated, and the Conclusion must repeat it once. Never
claim federated accuracy, convergence, or privacy. Do not delete those two
statements.

### Section structure (author-specified; mirrors the template paper)

| # | Section | Absorbs |
|---|---|---|
| — | Abstract | — |
| I | Introduction | motivation + part of old Background |
| II | Literature Survey | old Related Work, rewritten as template-style prose |
| III | Methodology | part of old Background; **50/50 detection vs federated** |
| IV | Implementation and Results | old Experiments (condensed) + old Discussion |
| V | Conclusion | old Limitations and Future Work |

No other top-level sections. No separate Discussion, Limitations, Experiments, or
Related Work section.

### The word "synthetic" — author directive

Use it **as few times as possible**. It must NOT appear in the Abstract, in
Implementation and Results, or in any figure or table caption. It may appear **once
or twice in total**: in Methodology where the dataset is introduced, and optionally
once in the Conclusion's scope sentence.

This is a presentation constraint, **not** permission to misrepresent. Never
describe the data as real, observed, historical, or market-collected. Preferred
accurate neutral phrasings: "30,000 generated portfolio states", "simulated
decision states", "portfolio states constructed over 3,706 real NIFTY 50 sessions".
The market leg genuinely is real; the cross-section is not. Never claim real
investor outcomes or external validity.

**Absolute prohibitions** (Reviewer #2 + master prompt §7):
- Never write "85–88% accuracy" (rejected predecessor claim).
- Never attribute federated RL portfolio work to Noseda et al. Correct: **Yu, Wynter & Lim, Springer 2022**.
- Never claim privacy, anonymity, DP, or secure aggregation. Correct phrasing: *model updates are shared instead of raw data; privacy is not claimed.*
- Never claim external validity, real-investor outcomes, or beating buy-and-hold.
- Never report Sharpe / Sortino / MDD / turnover — **no path backtest exists**. Future work only.
- Never call AUC 0.649 "good"/"strong"/"high". It is the honest difficulty of the task.
- No marketing adjectives (novel, powerful, cutting-edge, robust-without-evidence).

**Terminology (use these exact terms everywhere):**
| Use | Never write |
|---|---|
| rebalancing-necessity detection | rebalancing prediction |
| rule-oracle degeneracy | data leakage / overfitting |
| backtested outcome labels | real labels / true labels |
| federated aggregation is *implemented* | federated results / federated accuracy |
| row-order 60/20/20 split | temporal split / chronological split |
| certainty-equivalent (CE) gain | profit / utility |

---

## 1. Dataset

| Item | Value |
|---|---|
| Primary dataset | `demo-dataset.csv`, **30,000** rows, **12** features |
| Train / val / test | **18,000 / 6,000 / 6,000** (row-order 60/20/20, `main.py:129-132`) |
| Positives / negatives | **15,026 / 14,974**, positive rate **0.5009** |
| Test-split positive rate | **0.5027** |
| Control dataset | `dataset.csv`, **5,000** rows, heuristic labels, positive rate **0.520** |
| Market data | NIFTY 50 daily closes, **3,706** sessions, **2011-08-01 → 2026-07-31** |
| Seed | **20260804** |
| Label horizon | **21** trading days |
| Risk aversion `A` | **45.0** |
| Round-trip cost `c` | **0.0035** (35 bps) |
| Reversion sensitivity | **0.07** |
| Betas | 0.55–1.55, SHA-256 derived, persistent |
| Elapsed range | 5–170 trading days; calendar conversion ×7/5 |
| Threshold | **0.5** |

Balance is structural (no resampling).

---

## 2. Primary model — Logistic Regression, C=1, standardized, 30k

| Metric | Value | Metric | Value |
|---|---|---|---|
| Validation AUC | **0.6585** | Test F1 | **0.5684** |
| **Test AUC** | **0.6489** | Test MCC | **0.2079** |
| Test PR-AUC | **0.6435** | Balanced accuracy | **0.6026** |
| Test accuracy | **0.6022** | Brier | **0.2336** |
| Test precision | **0.6250** | ECE (10 bins) | **0.0214** |
| Test recall | **0.5212** | Majority-class accuracy | **0.5027** |

- 5-fold CV AUC: **0.6519 ± 0.0094**, folds **0.6663, 0.6387, 0.6479, 0.6578, 0.6488**
- 5-fold CV PR-AUC: **0.6452 ± 0.0065**
- Bootstrap (1,000 resamples of the test split): test AUC 95% CI **[0.6342, 0.6622]**; accuracy 95% CI **[0.5892, 0.6140]**
- PR baseline (test positive rate): **0.5027**; Brier baseline at p=0.5: **0.25**

**Coefficients (standardized units), intercept = 1.6694:**

| # | Feature | Coef | corr(label) | Solo AUC |
|---|---|---|---|---|
| 1 | num_stocks | −0.0352 | −0.0219 | 0.5235 |
| 2 | max_stock_weight | +0.0525 | +0.0291 | 0.5274 |
| 3 | top3_concentration | −0.1686 | +0.0216 | 0.5273 |
| 4 | total_weight_drift | +0.0411 | +0.0331 | 0.5321 |
| 5 | portfolio_return | **+1.0661** | +0.1979 | 0.6051 |
| 6 | portfolio_volatility | −0.0213 | +0.0869 | 0.5651 |
| 7 | sector_concentration | +0.0645 | +0.0239 | 0.5170 |
| 8 | days_since_last_rebalance | −0.0978 | +0.0256 | 0.5157 |
| 9 | market_return_30d | +0.0894 | +0.0441 | 0.5417 |
| 10 | market_volatility_30d | **+1.0835** | +0.1086 | 0.5975 |
| 11 | market_drawdown_90d | −0.2602 | −0.0095 | 0.4972 |
| 12 | market_trend | −0.0941 | +0.0096 | 0.5090 |

Feature means/stds (30k, raw units), in the same order:
means `12.9093, 0.2705, 0.5253, 0.4092, 0.0570, 0.0106, 0.4386, 122.6721, 0.0144, 0.0090, −0.0411, 0.6733`;
stds `10.0162, 0.2287, 0.3102, 0.3433, 0.1099, 0.0209, 0.2759, 67.2327, 0.0555, 0.0047, 0.0480, 0.4690`.

---

## 3. Model comparison (same split, standardized unless noted)

| Model | Val AUC | Test AUC | Test acc |
|---|---|---|---|
| **LR C=1 (primary)** | **0.6585** | **0.6489** | **0.6022** |
| LR C=0.1 | 0.6584 | 0.6489 | 0.6027 |
| LR C=10 | 0.6585 | 0.6489 | 0.6013 |
| Random Forest (200 × depth 8) | 0.6750 | **0.6790** | 0.6290 |
| Gradient Boosting (200 × depth 3) | 0.6729 | 0.6743 | 0.6258 |
| SVM-RBF (C=1, 3-fold calibrated) | 0.6773 | 0.6702 | 0.6173 |
| LR raw features (no standardization) | 0.6447 | 0.6333 | 0.5942 |

RF/GB use `random_state=20260804`. **LR gives up 0.0301 AUC to RF** — state this
number explicitly and pay for it with FedAvg-compatibility, calibration,
interpretability and cross-runtime parity.

> Two cells were re-measured and differ from the dossier's transcription:
> GB test AUC **0.6743** (dossier 0.6744, seed-dependent) and LR-raw test accuracy
> **0.5942** (dossier 0.5863; converged in 775 iterations, no warnings).
> Use the re-measured values.

---

## 4. THE headline result — rule-oracle degeneracy

### 4a. Matched control (PRIMARY — use this everywhere as the headline)

The **same 30,000 feature rows** relabelled by the legacy heuristic
(`computeLabelScore`, reimplemented exactly in `scripts/reproduce.py`). Identical
rows, features, scaler, split and model class: **only the label function differs.**

| Label function on the same 30,000 rows | Val AUC | Test AUC | Test acc | Positive rate | corr(days, label) |
|---|---|---|---|---|---|
| Heuristic rule | **0.9900** | **0.9890** | 0.9458 | 0.6738 | **0.6074** |
| 21-day net-of-cost backtest | 0.6585 | **0.6489** | 0.6022 | 0.5009 | **0.0256** |

- **AUC gap = 0.3401.** This is the paper's central claim and it is now unconfounded.
- Agreement between the two label sets on the same rows: **0.5221** — the heuristic
  and the economic outcome disagree on nearly half of all portfolios.

### 4b. Legacy-corpus control (SECONDARY — corroborating only)

The shipped 5,000-row heuristic-labelled dataset: val AUC **0.9121**, test AUC
**0.9310**, test acc **0.8440**, positive rate 0.520, corr(days, label) **0.4192**.

This arm uses a **different corpus** (5,000 rows, different positive rate, and the
shipped scaler was fitted on it, so it is standardized in-sample). It must be
presented as corroborating evidence, never as "the identical pipeline". Always
name the corpus difference when citing it.

> **Wording rule.** "Identical pipeline / everything held fixed except the label"
> is TRUE only of §4a. When citing §4b, say "a separate 5,000-row corpus labelled
> by the same heuristic".

---

## 5. Deterministic rule baselines (dossier §11.3, scored on the same 6,000 test rows)

| Baseline | Definition | AUC | Acc | Prec | Recall | F1 | MCC |
|---|---|---|---|---|---|---|---|
| B0 Majority | always predict 1 | 0.5000 | 0.5027 | — | — | — | 0.0000 |
| B1 Time-based | `days ≥ 90` | 0.5167 | 0.5175 | 0.5157 | 0.6598 | 0.5789 | 0.0349 |
| B2 Band trigger | `drift > 0.20 ∧ w_max > 0.35` | 0.5146 | 0.5137 | 0.5257 | 0.3319 | 0.4069 | 0.0315 |
| **B3 Legacy heuristic** | `computeLabelScore` | **0.5278** | 0.5287 | 0.5235 | 0.6953 | 0.5973 | 0.0590 |
| B5 LR (ours) | learned | **0.6489** | **0.6022** | 0.6250 | 0.5212 | 0.5684 | 0.2079 |

**B3 is the argumentative payload.** The product's own hand-written rule — the one
a naively trained model reproduces at AUC 0.9890 — predicts actual net-of-cost
rebalancing benefit at AUC **0.5278**, barely above chance. Learning the rule well
and making good decisions are almost unrelated. McNemar LR vs B3: n01 = 1586,
n10 = 1145, p = 3.24 × 10⁻¹⁷.

B1/B2 are near-chance on outcome labels: the conventional calendar and band rules
carry almost no information about whether rebalancing actually pays. Note B1/B2 are
deterministic rules, so their "AUC" equals balanced accuracy.

**McNemar exact tests, paired hard labels vs LR (6,000 test rows):**

| Comparison | n01 (LR right) | n10 (LR wrong) | p |
|---|---|---|---|
| LR vs B1 | 1701 | 1193 | 3.43 × 10⁻²¹ |
| LR vs B2 | 1572 | 1041 | 2.38 × 10⁻²⁵ |
| LR vs majority | 2041 | 1444 | 4.48 × 10⁻²⁴ |
| LR vs RF | 414 | 575 | 3.42 × 10⁻⁷ |
| LR vs GB | 438 | 580 | 9.60 × 10⁻⁶ |

LR significantly beats every deterministic baseline and is significantly *beaten* by
RF and GB. Report both directions honestly.

---

## 6. Ablations (test AUC; full model = 0.6489)

| Ablation | Test AUC | Δ vs full |
|---|---|---|
| Full 12-feature model | 0.6489 | — |
| A1 − `days_since_last_rebalance` | 0.6483 | **−0.0006** |
| A2 − market block (4 feats) | 0.6280 | −0.0209 |
| A3 − portfolio block (7 feats) | 0.6045 | −0.0444 |
| Market features only | 0.6043 | −0.0446 |
| Portfolio features only | 0.6193 | −0.0296 |
| A4 scaler refit on 30k train split | 0.6490 | **+0.0001** |
| A5 row-shuffled split | 0.6477 | −0.0012 |

Two ablations do real argumentative work:
- **A1 (−0.0006)** proves the time-collinearity defect is gone: removing `days` costs
  essentially nothing, whereas on rule labels `days` correlates 0.42 with the label.
- **A4 (+0.0001)** quantifies the scaler defect as **negligible for accuracy** — the
  shipped legacy-5k constants cost ~1e-4 AUC. Disclose the defect, then report this.

**Scaler mismatch magnitude** (shipped legacy-5k vs 30k refit), largest offenders:
`num_stocks` |Δmean| 3.9504, |Δstd| 6.2677; `days_since_last_rebalance` |Δmean| 2.8127,
|Δstd| 6.0035; `market_trend` |Δmean| 0.1777; `market_drawdown_90d` |Δmean| 0.1419.

---

## 7. Threshold sweep (A7) — explains the precision/recall asymmetry

| Threshold | Acc | Precision | Recall | F1 |
|---|---|---|---|---|
| 0.3 | 0.5152 | 0.5091 | 0.9907 | 0.6726 |
| 0.4 | 0.5715 | 0.5460 | 0.8750 | 0.6724 |
| **0.5** | **0.6022** | **0.6250** | **0.5212** | **0.5684** |
| 0.6 | 0.5735 | 0.7154 | 0.2517 | 0.3723 |
| 0.7 | 0.5380 | 0.7675 | 0.1160 | 0.2016 |

Answers Reviewer #2 §2.5/§2.7: 0.5 is accuracy-optimal; the conservative recall
(0.5212 < precision 0.6250) is an operating-point choice, and an asymmetric-cost
deployment can move it.

---

## 8. Federated design constants (implemented + unit-tested; NOT evaluated)

| Constant | Value |
|---|---|
| MIN_PARTICIPANTS | 2 |
| MAX_UPDATE_L2_NORM (clip L) | 5.0 |
| PUSH_ATTEMPTS | 3 |
| MAX_UPLOAD_SAMPLES | 10,000 |
| MIN_UPLOAD_INTERVAL | 3,600,000 ms (1 h) |
| Contract versions | feature 1 / scaler 1 / model 1 |
| Parity tolerance | 1e-12 (Python), 1e-5 (TF.js) |

Aggregation arithmetic verified at unit level: (120·0.4 + 360·0.8)/480 = **0.7**
(unweighted mean would be 0.6); and (100·0.25 + 300·1.25)/400 = **1.0**.

Default flags: `FEDERATED_CONTRIBUTIONS_ENABLED`, `FEDERATED_AGGREGATION_ENABLED`,
`OUTCOME_BASED_MODEL_ENABLED` all **false**.

**Mandatory sentence somewhere in the paper**: federation is implemented, validated and
unit-tested but **disabled by default and not experimentally evaluated**; federated
accuracy/convergence results are future work.

---

## 8b. Generator constants (source: `05_synthetic_dataset.md` §5.2/§5.4)

These are **configuration read from the generator source**, not measurements. They
appear in Tables T3 and T4 and inside E17–E22. They are listed here so that a
numeric audit of the paper resolves every decimal to a source.

Basket profiles (holdings, spread ρ, share): whole_universe 30–45 / 0.05 / 0.10;
broad 12–25 / 0.15 / 0.22; mid 8–15 / 0.30 / 0.22; single_sector 4–8 / 0.55 / 0.16;
focused 4–9 / 1.20 / 0.18; dominant_position 3–7 / 1.90 / 0.12.

Generator: `MARKET_WARMUP_DAYS` 90; elapsed 5–170; trading/calendar 5/7; β range
0.55–1.55; `REVERSION_SENSITIVITY` 0.07; reversion clamp [−0.0945, 0.21];
volatility pivot/scale 0.009 / 0.005; drawdown pivot/scale −0.05 / 0.08;
`SECTOR_SHOCK_SCALE` 0.6; `IDIOSYNCRATIC_SCALE` 1.1; `RISK_AVERSION` 45.0;
`TURNOVER_COST_RATE` 0.0035; growth floor 0.01.

Heuristic control E24: logistic centre 60, steepness 40, clamp ±2.5, and the
tiered `delta` increments (1.2/0.6/−0.8, 0.8/0.3/−0.5, 0.8/0.3/−0.4, 0.6/0.3/−0.4,
−0.4, 0.5/−0.3, 0.4/−0.2, 0.4) — reimplemented verbatim in `scripts/reproduce.py`
from `apps/react-client/lib/featureEngineering.ts`.

TF.js runtime: Adam learning rate 0.05, batch 32.

**Caveat to keep disclosed:** the generator itself lives on an unmerged branch, so
these constants are verifiable only against that source and must ship with the
artifact.

## 9. Explicitly NOT measured — mark as future work, never fill in

- Any path-based financial backtest: Sharpe, Sortino, MDD, turnover, annual return.
- Any federated experiment: FedAvg-vs-centralized AUC, convergence, K-client
  partitions, non-IID, poisoning robustness.
- Regime holdout (e.g. 2020-only rows).
- Neural-network baselines (MLP).
- Wilcoxon signed-rank tests (McNemar and bootstrap ARE computed — use those).
- Training/inference wall-clock timings.
- Hosmer–Lemeshow test.

---

## 10. Equation numbering (from `10_mathematical_framework.md`)

Use LaTeX labels `eq:e1` … `eq:e43` mapping to E1–E43. Sections must reference the
equations they use. Core set the paper must contain:
E1 (task), E2–E16 (features + standardization), E17–E22 (generator),
**E23 (the ΔCE label — the most important equation)**, E24 (heuristic control),
E25–E27 (logistic model, decision rule, loss), E28–E30 (clip, FedAvg, gating),
E31–E34 (metrics), E42–E43 (McNemar/bootstrap).

**E23**: `ΔCE(w,t,f) = (t−w)ᵀf + A·[Var_ex(w) − Var_ex(t)] − c·‖t−w‖₁`, `y = 1{ΔCE > 0}`.

---

## 11. Citation keys (agent 7 owns `references.bib`; everyone uses these keys)

`markowitz1952`, `sharpe1966`, `mcmahan2017`, `li2020challenges`, `li2020noniid`,
`yang2019federated`, `noseda2025`, `mashrur2020`, `javeed2024`, `yu2022fedrl`,
`jegadeesh1993`, `adedoyin_ai`, `kumari2024`, `heaton2017`.

Citation duties (from `08_literature_review.md` §8.5):
- static rebalancing inadequate → `adedoyin_ai`, `kumari2024`
- LR for binary financial decisions → `kumari2024`
- FL recovers centralized accuracy on non-IID finance data → `noseda2025`
- FL threat model / on-device rationale → `javeed2024`, `yang2019federated`
- synthetic financial data legitimacy → `mashrur2020` (§VI.E)
- FedAvg algorithm → `mcmahan2017`; non-IID → `li2020challenges`, `li2020noniid`
- plain FedAvg fails in federated RL portfolio management → `yu2022fedrl`
- mean-variance / risk-adjusted return → `markowitz1952`, `sharpe1966`
- momentum & reversion → `jegadeesh1993`

---

## 12. Figures and tables actually produced

Figures (in `figures/`): F1 architecture (TikZ), F2 generation pipeline (TikZ),
F3 label mechanism (TikZ), F4 label balance, F5 feature–label correlation,
F6 ROC curves, F7 PR curve, F8 calibration, F9 correlation heatmap,
F10 coefficients, F11 negative control, F12 FedAvg workflow (TikZ),
F13 aggregation arithmetic (TikZ), F14 CV fold spread.

Tables (in `tables/`): T1 dataset, T2 features, T3 basket profiles, T4 generator
parameters, T5 hyperparameters, T6 model comparison, T7 baselines + McNemar,
T9 ablations, T10 FedAvg constants, T12 statistical validation, T13 threshold sweep.

**T8 (financial metrics) and T11 (timings) are NOT produced** — the underlying
experiments do not exist. Do not create them.
