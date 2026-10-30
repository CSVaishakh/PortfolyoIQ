# master_outline.md — Principal Investigator's global outline

Paper: **"Rebalancing-Necessity Detection with Backtested Synthetic Labels on NIFTY 50:
Measuring and Removing Rule-Oracle Degeneracy in a Federated-Ready Design"**

Target: IEEEtran conference, double column, 10pt, ~7 pages including references.
All numbers come from `FACTS.md`. All citation keys come from `FACTS.md` §11.

---

## The one-sentence thesis

*A rebalancing classifier trained on labels produced by its own heuristic is a
decompiler of that heuristic (AUC 0.931); replacing those labels with forward,
net-of-cost backtested outcomes yields an honest and much harder problem (AUC 0.649),
and the 0.282 gap is a measurable diagnostic that the ML-finance literature has
asserted but never quantified for rebalancing.*

Every section must serve this thesis.

---

## Narrative arc (each section hands off to the next)

1. **Intro** — rebalancing decisions matter; "AI rebalancing" work is conceptual; those
   that are empirical label data with rules. → *What happens if we measure that?*
2. **Related work** — nobody treats necessity detection as supervised classification
   on outcome labels. → *So we build one.*
3. **Methodology** — the system, the 12-feature contract, the generator, and above all
   **E23**, the ΔCE label that contains no `days` term. → *Now evaluate it.*
4. **Experiments** — the model is mediocre in absolute terms (0.649) and that is the
   point; the same pipeline scores 0.931 on rule labels; deterministic baselines are
   near chance; ablations show the time-leak is gone. → *What does that mean?*
5. **Discussion** — interpret coefficients; defend LR despite −0.030 AUC to RF; disclose
   the scaler defect and show it costs 1e-4 AUC; scope federation honestly.
6. **Limitations / Conclusion** — synthetic, in-family, no path backtest, no federated
   results. Restate contributions with numbers.

---

## Section ownership and file map

| File | Owner | Content | Target length |
|---|---|---|---|
| `sections/01_introduction.tex` | Agent 2 | Motivation, gap, C1–C5, organization | 0.7 pp |
| `sections/02_related_work.tex` | Agent 2 | 4 themed subsections + positioning | 0.8 pp |
| `sections/03_methodology.tex` | Agent 3 | Architecture, features, generator, label, model, FedAvg | 2.0 pp |
| `sections/04_experiments.tex` | Agent 4 | Setup, main results, negative control, baselines, ablations, statistics | 1.6 pp |
| `sections/05_discussion.tex` | Agent 5 | Interpretation, LR defence, scaler, federation scoping, limitations | 1.0 pp |
| `sections/06_conclusion.tex` | Agent 5 | Restate + future work | 0.25 pp |
| `references.bib` | Agent 7 | 14 entries | — |
| `figures/`, `tables/` | PI (agent 6) | 14 figures, 11 tables | — |
| `paper.tex` | PI (agent 8) | Preamble, abstract, includes | — |
| `review_report.md` | Agent 9 | Reviewer #2 pass | — |

---

## Detailed section plan

### Abstract (~160 words)
Motivate rule-oracle degeneracy → state the detector and the 30k backtested dataset →
report 0.649 test AUC, CV 0.652±0.009, ECE 0.021, Brier 0.234 → report the 0.931
control and the 0.282 gap → deterministic baselines near chance (0.517/0.515) →
one honest scope sentence (synthetic, federation not evaluated, not investment advice).

Index terms: portfolio rebalancing, federated learning, logistic regression, synthetic
data, NIFTY 50, necessity detection, model calibration.

### I. Introduction
- I.A Motivation: drift, cost/benefit, why calendar and band rules are crude (cite
  `adedoyin_ai`, `kumari2024`, `markowitz1952`).
- I.B The labelling problem: where do labels come from? Rules ⇒ degeneracy. Introduce
  the term **rule-oracle degeneracy**.
- I.C Contributions C1–C5 verbatim from `09_research_gap.md`, each with its number.
- I.D Organization.
- Reference F1 (architecture) here.

### II. Background and Related Work
- II.A Portfolio rebalancing and drift.
- II.B ML in financial risk (`mashrur2020`, `kumari2024`).
- II.C Federated learning (`mcmahan2017`, `li2020challenges`, `li2020noniid`,
  `noseda2025`, `javeed2024`, `yu2022fedrl`) incl. the plain-FedAvg failure in
  federated RL and the DP-utility collapse.
- II.D Synthetic financial data (`mashrur2020` §VI.E).
- II.E Positioning paragraph = the gap.

### III. System Design and Methodology
- III.A Architecture, three tiers, two contracts (F1).
- III.B Problem formulation (E1).
- III.C Feature engineering: E2–E15, standardization E16, scaler-provenance
  disclosure. Reference T2.
- III.D Synthetic generation: E17–E22, F2, T3, T4.
- III.E Label generation: **E23** + F3; explain the deliberate absence of `days`;
  control label E24.
- III.F Model and training: E25–E27, T5.
- III.G Federated-ready aggregation: E28–E30, F12, F13, T10 + the "not evaluated,
  disabled by default, privacy not claimed" paragraph.

### IV. Experiments
- IV.A Setup: data, split, environment pinning, threshold, reproduction command.
- IV.B Main results: T6, F6, F7, F8, F14. Report against majority 0.5027 and PR
  baseline 0.5027 so nothing is oversold.
- IV.C **Negative control** (F11, §4 of FACTS) — the headline.
- IV.D Deterministic baselines + McNemar (T7).
- IV.E Ablations (T9) — A1 and A4 carry the argument.
- IV.F Statistical validation (T12): CV, bootstrap CI, McNemar. Threshold sweep T13.
- IV.G Explicit statement: no path-based financial evaluation.

### V. Discussion
- V.A Why 0.649 is the honest ceiling, not a weak model (task hardness by construction,
  cost band near zero ⇒ many near-indifferent rows).
- V.B Coefficient interpretation (F10): market vol +1.084, portfolio return +1.066,
  drawdown −0.260, top-3 −0.169. Economic plausibility.
- V.C Why LR despite −0.0301 AUC to RF: FedAvg object, calibration, parity, 100-byte
  model. State the loss explicitly and cite the McNemar p.
- V.D Scaler-provenance defect: disclose, then report A4 = +0.0001 AUC.
- V.E Federation scoping: implemented, gated, unevaluated; privacy not claimed.
- V.F Operating point and the recall asymmetry (T13).

### VI. Limitations and Future Work
Synthetic in-family cross-section; label and simulation share a factor model; flat
35 bps costs; no real outcomes; no regime holdout; no path backtest; no federated
evaluation; `days` is an estimate for real users; calendar/trading rounding seam;
targets fixed at t₀; generator lives on an unmerged branch (artifact requirement).

### VII. Conclusion
Restate the 0.931 → 0.649 result and the contributions. Two forward-looking sentences.

---

## Consistency rules enforced at merge

1. `\label{sec:...}`, `\label{eq:e...}`, `\label{fig:f...}`, `\label{tab:t...}`.
2. Every figure, table and equation is referenced at least once in prose.
3. Numbers appear in the same rounding everywhere (4 dp for AUC, e.g. 0.6489;
   3 dp when prose-rounded, e.g. "0.649" — never mix within one sentence).
4. Abstract numbers ≡ Experiments numbers ≡ Conclusion numbers.
5. Intro contributions ≡ Conclusion contributions.
6. No section repeats another section's explanation of the label; III.E owns it.
7. IEEE style: "Fig.~\ref{}" mid-sentence, "Table~\ref{}", `\eqref{}` for equations.
