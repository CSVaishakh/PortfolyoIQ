# Review Report — Reviewer #2

Manuscript: *Rebalancing-Necessity Detection with Backtested Synthetic Labels on NIFTY 50:
Measuring and Removing Rule-Oracle Degeneracy in a Federated-Ready Design*
Artifact reviewed: `paper/paper.pdf`, 16 pages, IEEEtran `[conference]`, 14 figures, 11 tables,
28 numbered equations, 14 references, ~12,580 words.
Ground truth consulted: `paper/FACTS.md`, `paper/figures/results.json`,
`research-report/15_reviewer_comments.md`.

---

## Verdict

**Major revision.**

The numeric hygiene of this manuscript is the best I have reviewed in this area — I checked
179 reproducible quantities against the raw output and found zero fabrications, zero rounding
drift in the experimental values, and no trace of the prohibited claims (no "85–88%", no
Sharpe/Sortino, no privacy claim, no federated result, correct Yu/Wynter/Lim attribution).
It nonetheless cannot be accepted as submitted, because the paper's single headline claim —
that the 0.282 AUC gap is "attributable to the label rather than to the learner" — rests on a
comparison between two *different datasets* (30,000 rows vs 5,000 rows, different corpora,
different positive rates), a confound the paper never acknowledges while repeatedly asserting
that "everything" was held fixed except the label. That, one unsupported contribution (C4,
cross-runtime parity, claimed but never measured), one direct internal contradiction about
whether a task ceiling was established, and a 16-page length against a 6-page target, are what
stand between this and acceptance. All four are fixable; none requires new science.

## Summary of the paper

The paper argues that supervised rebalancing models in the applied literature are trained on
labels emitted by the same heuristics they are meant to replace, so the classifier recovers the
rule instead of learning an economic decision — a pathology the authors name *rule-oracle
degeneracy*. To avoid it they generate 30,000 synthetic portfolio states over 3,706 real
NIFTY 50 sessions and label each by the sign of a 21-trading-day, net-of-cost certainty-equivalent
gain (Eq. 21), then train an L2-regularized logistic detector on a twelve-feature contract. The
detector reaches test AUC 0.6489 with good calibration (ECE 0.0214, Brier 0.2336 against 0.25),
while the same pipeline on heuristic labels reaches 0.9310 — the degeneracy exhibit — and
conventional calendar and band rules reach 0.5167 and 0.5146, near chance. A federated averaging
path is implemented and unit-tested but disabled, unevaluated, and explicitly excluded from the
claims.

---

## Strengths

1. **Numeric discipline is exceptional.** I ran a programmatic cross-check of every stated
   experimental value against `figures/results.json`: 161 of 161 quoted quantities match to the
   printed precision. The eighteen non-matches in my sweep are scaler-difference entries the
   paper deliberately does not quote — it quotes only the four largest offenders (3.9504, 6.2677,
   2.8127, 6.0035, plus 0.1777 and 0.1419), and all six of those match. The two re-measured cells
   are used consistently everywhere (GB test AUC **0.6743**, LR-raw test accuracy **0.5942**);
   the superseded dossier transcriptions 0.6744 and 0.5863 appear nowhere in the `.tex` sources,
   the PDF, or the bibliography.

2. **The paper refuses its own best-looking number.** §IV.C: *"The figure 0.9310 is not evidence
   of a capable model and is not reported as an achievement. It is the quantity this paper exists
   to measure."* Fig. 11's caption repeats it: *"The high left-hand bar is evidence of a
   degenerate label, not of a capable model."* This is rare and it is the right call.

3. **Every metric carries its baseline.** §IV.B states majority accuracy 0.5027, PR baseline
   0.5027 and AUC baseline 0.5000 in the same paragraph as the headline metrics; Fig. 6's caption
   insists PR-AUC 0.6435 *"should be read against that reference of 0.5027 rather than against
   unity"*; Table X has a dedicated "Reference levels" block. Punch-list §2.7 is fully satisfied.

4. **Losses are reported as loudly as wins.** Table VIII reports McNemar in both directions,
   including the two comparisons the proposed model loses (RF p = 3.42 × 10⁻⁷, GB p = 9.60 × 10⁻⁶),
   and §V.C states outright: *"Any claim that the linear model is competitive on accuracy alone is
   unsupportable."* §IV.D closes with *"Both directions are reported because both are true."*

5. **AUC 0.6489 is never oversold.** §V.A opens *"A test AUC of 0.6489 is a modest number in
   absolute terms"*; §IV.B places it *"far from the range in which a classification decision could
   be taken with confidence."* I found no instance of "good", "strong", "high", or any marketing
   adjective applied to it.

6. **The privacy scoping is correct and prominent.** §III.A, §III.G, §V.E and §VII all state that
   sharing updates is data minimisation only, that neither DP nor secure aggregation is
   implemented, that *"updates travel in the clear"*, and that Sybil resistance is unsolved. §V.E
   even notes that norm clipping *"is a robustness control rather than a disclosure control"* —
   a distinction most FL systems papers get wrong.

7. **The model-choice trade is quantified, not argued.** §V.C: *"0.0301 AUC surrendered for
   aggregability, calibration, cross-runtime parity and model size"*, with a falsifier attached:
   *"If federation were abandoned, the reasoning above would lose its force, and a non-federated
   nonlinear model trained on a central server would be the sensible choice on this data."*

8. **The deterministic-baseline result is the most useful practical finding in the paper** and is
   honestly qualified — §IV.D notes B1/B2 emit hard decisions so *"their AUC is equal to their
   balanced accuracy and should be read as such."*

---

## Critical defects

**C-1. The negative control is confounded: the two arms use different datasets, and the paper
says they do not.**

This is the paper's central claim and the reason it exists, so I will be exact.

- Abstract: *"The **identical pipeline** reaches 0.9310 … a gap of 0.282 AUC attributable to the
  label rather than to the learner."*
- §I.C, contribution C2: *"The **identical pipeline** scores test AUC 0.9310 on heuristic labels
  and 0.6489 on backtested labels … a gap of 0.282 attributable to the label rather than the
  learner."*
- §IV.C, opening sentence: *"The central experiment **holds everything fixed except the label**."*
- §VII: *"With the model class, the scaler, the split protocol and the evaluation code held fixed,
  the same logistic pipeline attains a test AUC of 0.9310 …"*

But §IV.C's own next sentence says the control arm is applied *"to the **5,000-row control
dataset**"*, and Table VI (p. 10) lists `demo-dataset.csv` at 30,000 rows / positive rate 0.5009
against `dataset.csv` at 5,000 rows / positive rate 0.5200. So the two arms differ in **corpus,
in sample size by 6×, and in class balance**. "Everything fixed except the label" is false as
written. The correct alternative hypothesis is not "the learner" — it is *the data*: a 5,000-row
corpus with a different feature distribution, evaluated on a 1,000-row test split rather than a
6,000-row one. The paper never names this confound, not in §IV.C, not in §V, not in the §VI
limitations, which is where I looked for it hardest.

It gets worse in one specific respect the paper is otherwise scrupulous about. §III.C discloses
that the shipped scaler constants derive **from the legacy 5,000-row dataset**. That means the
control arm is standardized by *in-sample* statistics while the treatment arm is standardized by
*out-of-sample* statistics. The comparison is therefore asymmetric in the direction that flatters
the degeneracy result. Ablation A4 shows the mismatch costs only 0.0001 AUC on the 30k side,
which mitigates the magnitude but does not repair the argument.

*Required fix, and it is cheap:* relabel the **same 30,000 feature rows** with the heuristic of
Eq. (22), refit, and report that AUC. That is the experiment the prose already claims to have
run. If it reproduces something near 0.93, the paper's central claim becomes airtight and the
result gets stronger, not weaker. Until then, C2, the abstract, §IV.C and §VII must be reworded
to "a different corpus labelled by the heuristic" and the dataset difference must be stated as a
limitation.

**C-2. Contribution C4 (cross-runtime parity) is claimed as a delivered result but no measurement
appears anywhere in the paper.**

C4 promises *"the browser and server implementations are required to agree to 10⁻¹² in double
precision and 10⁻⁵ under the browser runtime."* The word "required" is careful and correct — it
describes a contract. But §V.C then escalates to an empirical claim: *"the same arithmetic **is
reproducible** across the browser and server runtimes to a tolerance of 10⁻¹²"*, and uses it as
one of the four justifications for accepting a 0.0301 AUC deficit. No parity experiment, fixture
count, maximum observed deviation, or pass/fail result is reported anywhere in §IV. Table V lists
10⁻¹² and 10⁻⁵ as *constants*, alongside `MIN_PARTICIPANTS` and `PUSH_ATTEMPTS`. `FACTS.md` §8
likewise lists them under "Federated design constants (implemented + unit-tested; **NOT
evaluated**)".

This is precisely the class of defect the paper spends seven paragraphs correctly avoiding for
the federated path. Either report the measurement (five fixtures, max |Δ| observed, in a two-line
table) or demote C4 from a contribution to a design statement and change §V.C's "is reproducible"
to "is required to agree".

**C-3. §IV.B and §V.A directly contradict each other on whether a task ceiling was established.**

§IV.B, p. 10: *"The close agreement between validation AUC 0.6585 and test AUC 0.6489 indicates
that **the ceiling is a property of the task** and not of overfitting."*

§V.A, p. 10–11: *"we did not compute a learned-utility upper bound, an irreducible-error estimate
or a Bayes-rate approximation for the backtested label, so **we cannot quantify how much of the
remaining headroom above 0.6489 is attainable**. The claim is that the task is hard by
construction, **not that 0.6489 is the best achievable value**; Table VII shows that nonlinear
learners already exceed it."*

Both cannot stand. Independently, §IV.B's inference is invalid on its own terms: validation–test
agreement bounds *overfitting to the training split*; it says nothing whatsoever about a ceiling.
And Table VII refutes the claim two pages earlier than §V.A does — RF reaches 0.6790 on the same
split. Delete the second half of the §IV.B sentence.

**C-4. The generator — the object the entire dataset depends on — is not reproducible from the
paper, is partly outside the numeric contract, and its source code is admittedly unpublished.**

Three compounding problems:

(a) **Eq. (21) is under-specified.** It introduces the forward shocks η′_sec(i) and ε′_i with no
distribution stated. Eq. (19) gives scales for the *span* shocks (0.6 σ_span, 1.1 σ_span); the
forward shocks are simply primed and left undefined. Eq. (22) then uses 0.6² and 1.1² against
σ_h = σ_m√21, which implies the intended scales, but the paper never says so. A reader cannot
regenerate the labels from the text.

(b) **~20 generator constants live outside the numeric contract.** Table II (six holdings ranges,
six ρ values, six sampling shares) and Table III (`MARKET_WARMUP_DAYS` 90, reversion clamp
[−0.0945, 0.21], volatility pivot/scale 0.009/0.005, drawdown pivot/scale −0.05/0.08,
`SECTOR_SHOCK_SCALE` 0.6, `IDIOSYNCRATIC_SCALE` 1.1), plus Eq. (22)'s constants (2.5, 60, 40),
appear in neither `FACTS.md` nor `results.json`. They are not *wrong* — they plainly come from
the generator source — but they are the one numeric block in the paper that a reviewer cannot
verify against anything.

(c) **The source is not published.** The Reproducibility section states: *"The dataset generator
currently resides on an unmerged branch and must be published alongside the artifact."* §VI
repeats it. That is exactly the condition the original punch-list (§3.6) called **"unacceptable"**.

Group (b) is only unverifiable *because* of (c). Merging the generator resolves both, and it is a
git operation, not research. Until it lands, the 30,000-row dataset — the paper's only dataset —
is an assertion.

---

## Major concerns

**M-1. The abstract's comparator set is selective.** The abstract reports the detector's 0.6489,
the 0.282 degeneracy gap, and the two rules the detector *beats* (0.5167, 0.5146). It never
mentions that a random forest reaches 0.6790 on the identical split and beats the detector at
p = 3.42 × 10⁻⁷, nor reports accuracy (0.6022) against the majority rate (0.5027). The body is
scrupulous about both (§IV.B, §V.C). A reader who reads only the abstract — which is most readers
— gets a materially more favourable picture than the paper itself supports. Add one clause:
"a random forest reaches 0.6790 on the same split; the linear model is chosen on deployment
grounds."

**M-2. The central defence of AUC 0.6489 is asserted, never measured.** §V.A's argument is that
|ΔCE| is small relative to the 0.0035 cost for many rows, so the sign is near-unlearnable. The
supporting sentences are *"the drift-driven expected-return and risk terms are **frequently** of
the same order as the round-trip cost"* and *"For a **large fraction** of the 30,000 generated
portfolios the two courses of action are therefore close to economically indifferent."* No number
is attached to "frequently" or "large fraction". The generator computes ΔCE for all 30,000 rows;
its distribution is free. A single histogram of |ΔCE|, or the fraction of rows with
|ΔCE| < 0.0035, would convert the paper's main interpretive claim from rhetoric to measurement —
and would replace at least two of the figures I recommend cutting. This is the highest-value
missing experiment in the paper.

**M-3. Baseline B3 — the project's own heuristic, scored against outcome labels — is missing, and
it is the one baseline that would land hardest.** The punch-list §2.4 asked for "90-day calendar,
band-trigger, **legacy heuristic**" on the same test labels. Table VIII delivers B0, B1, B2 only.
Scoring Eq. (22) as a decision rule on the same 6,000 outcome-labelled test rows would directly
demonstrate that the incumbent production heuristic is near-chance on what actually matters —
the paper's whole thesis, stated as a number rather than as an inference from a 0.9310 on a
different corpus. It is trivial to compute (the rule is deterministic and already implemented).
Its absence is also visible to the reader: **Table VIII's rows are labelled B0, B1, B2, B5**, with
B3 and B4 never defined or mentioned, so the reader is left to wonder what was dropped.

**M-4. §VI states the calendar/trading-day conversion backwards.** §VI: *"Elapsed calendar time is
converted to trading days by a factor of 7/5."* That is the wrong direction — multiplying calendar
days by 7/5 lengthens them. Table III labels the same quantity *"trading/calendar ratio … 5/7"*,
and §III.C says the eighth feature is *"in calendar days"* while Table III gives the elapsed range
as *"5–170 **trading** days"*. Table I's mean of 122.6721 calendar days is consistent with trading
days × 7/5 (≈87.5 × 1.4), so the *generator* is right and the §VI sentence is wrong. Three
statements of one constant, one of them inverted.

**M-5. Figures are not numbered in order of first citation.** The first-citation sequence is
1, 2, 3, 4, **14**, **8**, **7**, **5**, **6**, 9, 10, **13**, **11**, **12**. IEEE requires
figures be numbered in the order they are first cited. Consequences for the reader are real:
Fig. 14 is cited in §III.G on p. 6 and printed on p. 15; Fig. 13 is cited on p. 10 and printed on
p. 15. Tables are correctly ordered (I–XI), which makes the figure disorder look like an oversight
rather than a policy. (See the audit section for the full map.)

**M-6. A load-bearing citation is uncitable.** Reference [4] prints as *"A. Adedoyin,
'AI-enhanced tools for rebalancing investment portfolios,' no publication venue, date, or DOI
available."* I respect the decision not to fabricate a venue — `references.bib` documents that
choice explicitly, and it is the right instinct. But [4] is cited in §I.A and §II.A as one of two
supports for the paper's motivating claim that static rebalancing policies are inadequate. An
IEEE editor will not accept a reference with no venue and no year. Either locate the real
publication or drop [4] and rest that claim on [5] plus the paper's own B1/B2 measurements —
which, note, are *stronger* evidence than either citation.

**M-7. The paper's only external quantitative evidence for federated viability is an unrefereed
preprint.** §II.C's numbers (0.7162 vs 0.7295 IID; 0.7206 vs 0.5366 non-IID) and §V.E's
DP-collapse claim both come from [13], an arXiv preprint (arXiv:2509.16393, 2025). I verified
these four values against `research-report/08_literature_review.md` line 45 and they are
transcribed correctly and attributed correctly. But they are the sole quantitative external
support for the design rationale, and they are not peer-reviewed. Flag the preprint status
in-text.

**M-8. The bootstrap-vs-point-estimate comparison in §IV.F is not a valid test.** *"the AUC
interval also excludes the random forest's 0.6790, consistent with the McNemar result above."*
A one-sample bootstrap CI for LR's AUC excluding RF's *point estimate* is not a test of the
difference — the two estimators are evaluated on the same rows and are strongly positively
correlated. The conclusion happens to be right (McNemar establishes it properly), so delete the
clause rather than defend it.

**M-9. "the last is a Herfindahl index, which is *precisely what* (4)–(6) measure" (§III.D) is
false.** Σᵢwᵢ² is a Herfindahl index. Eq. (4) is max weight, Eq. (5) is a top-3 sum, Eq. (6) is an
L1 distance from equal weight. None of them *is* the Herfindahl; they are correlated proxies —
which is exactly what Fig. 10 shows (0.91, 0.92 within the family). Change "precisely what" to
"correlated with"; the argument survives intact and becomes true.

**M-10. Missing citations for standard methodology.** No reference is given for: expected
calibration error / reliability diagrams (Naeini et al.; Guo et al.), Brier score (Brier 1950),
Matthews correlation coefficient (Matthews 1975), McNemar's test (McNemar 1947), the bootstrap
(Efron 1979), or **any** of the comparison learners — random forest, gradient boosting, RBF-SVM,
or the probability calibrator applied to the SVM. More substantively: the ΔCE criterion of
Eq. (21) is a one-period **no-trade-region** rule, and §III.E even says so (*"reproduces no-trade-band
behaviour without any band being coded"*), yet the classical transaction-cost rebalancing
literature (Constantinides 1986; Leland; Donohue & Yip) is absent from §II entirely. A reviewer
from finance will notice this before anything else. Eq. (11), a 30-day index return, is cited to
Jegadeesh & Titman [3], whose momentum is 3–12-month *cross-sectional relative strength* — a
stretch.

---

## Minor issues

1. **Abstract, p. 1: "a Brier score of 0.2336 against a baseline of 0.250."** Three digits. §IV.B
   writes "0.2500"; Table X and §V.C write "0.25". One number, three renderings, in a paper that
   is otherwise uniformly 4-dp. Pick one. (Same class of defect as the review brief's
   "0.6489 → 0.649" example.)
2. **"a gap of 0.282"** (abstract, C2, §IV.C, §VII) is 3-dp among 4-dp values throughout;
   0.9310 − 0.6489 = 0.2821. `FACTS.md` sanctions 0.282, so this is presentational, but it is the
   only 3-dp experimental value in the paper.
3. **Fig. 9's bar labels are 3-dp where Table I is 4-dp** for the same twelve quantities:
   +0.198 / +0.1979, +0.109 / +0.1086, +0.087 / +0.0869, +0.026 / +0.0256, +0.022 / +0.0216,
   −0.022 / −0.0219, +0.010 / +0.0096, −0.010 / −0.0095. Two features (`market_trend`,
   `market_drawdown_90d`) differing by 0.0001 in the table render as ±0.010 in the figure.
4. **Table VI writes the control positive rate as "0.5200"** while the same table writes 0.5009
   and 0.5027 — inconsistent significant figures within a single column.
5. **Table VIII rows are B0, B1, B2, B5.** B3 and B4 are never defined. Renumber to B0–B3 or
   explain the gap. (See M-3.)
6. **Author block is `\IEEEauthorblockN{PortfolioIQ Project}` with no `\IEEEauthorblockA`** — no
   affiliation, no email, no city/country. Not camera-ready under IEEEtran. If this is a
   double-blind submission, add the anonymization statement; if not, add the affiliation block.
7. **Page 16 carries 100 words** (three reference entries). A 16th page for three references is
   avoidable even before the cuts below.
8. **12 underfull `\hbox`/`\vbox` warnings** in `paper.log` (lines 51–79 and 239–244 of the
   sections), a consequence of the global `\sloppy` in `paper.tex`. Visible as loose inter-word
   spacing on pp. 3–4. Restrict `\sloppy` to the offending paragraphs.
9. **Eq. (18) contains "· 1.00"**, a no-op multiplier. Either drop it or write the range width as
   a named constant.
10. **"approximately one hundred bytes" (§III.F) and "approximately 100 bytes" (§V.C)** — state
    once, and state it exactly (13 × float64 = 104 B).
11. **Index Terms include "federated learning"** although the title deliberately demotes the word
    to "Federated-Ready". A reader searching the index terms will arrive expecting the results the
    title correctly declines to promise. Use "federated-ready architecture".
12. **Fig. 5's caption** says the four learners lie *"well below the 0.9310 **achieved** on
    heuristic labels."* "Achieved" is a celebratory verb for a degeneracy exhibit, and the ROC
    figure plots the 6,000-row test split while 0.9310 comes from a different corpus. Reword to
    "well below the 0.9310 the same pipeline returns under heuristic labels (Fig. 11)".
13. **Source labels no longer track printed numbers.** `fig:f13` prints as Fig. 14, `fig:f14` as
    Fig. 12, `fig:f10` as Fig. 13, `eq:e23` as (21); `eq:e3` and `eq:e8` do not exist. It compiles
    cleanly today, but the next person to move a float will make an error that LaTeX will not
    catch. Renumber the labels to match.
14. **§III.C says the elapsed feature is "in calendar days"; Table III gives the range in trading
    days.** Say both, once, with the conversion. (Related to M-4.)
15. **Fig. 3, Fig. 4, Fig. 12 and Fig. 14 have no PDF assets** — they are TikZ, which is correct
    and reproducible, but four TikZ floats plus ten plot floats is a heavy compile for a 6-page
    submission.

---

## Fabrication audit

**Result: no fabrications found. This is the strongest part of the submission.**

*Method.* I extracted every stated experimental quantity from the PDF text and the `.tex`
sources and compared it programmatically against `paper/figures/results.json` at printed
precision, then cross-read the abstract, §I, §IV and §V against `FACTS.md` §§1–8 by hand.

*Counts.*

| Check | Result |
|---|---|
| Reproducible quantities machine-checked against `results.json` | **179** |
| Matched verbatim at printed precision | **161** |
| Failed | **0** |
| Non-matches, all explained | 18 — every one a per-feature scaler-difference entry the paper deliberately does not quote. The paper quotes only the largest offenders (3.9504, 6.2677, 2.8127, 6.0035, 0.1777, 0.1419); **all six match**. |

*Coverage.* All 12 primary test metrics; validation AUC; intercept; all 12 coefficients, 12
label correlations, 12 solo AUCs, 12 means and 12 stds in Table I; all 5 CV folds plus both means
and both standard deviations; all 7 rows × 3 columns of Table VII; all 4 baseline rows and all 6
metrics each; all 5 McNemar comparisons (n01, n10, p); all 8 ablations; all 5 threshold-sweep rows
× 4 metrics; both bootstrap CIs; the negative-control block; and the scaler-refit AUC.

*Prohibited-content sweep (all clean):*
- "85–88%" / "85-88": **absent** from every `.tex` file and from the PDF.
- Sharpe, Sortino, maximum drawdown, turnover, annualised return: appear **only inside negative
  statements** (§IV.G, §VI) declaring they were not computed.
- Privacy / DP / secure aggregation / anonymity: appear **only inside denials** (§III.A, §III.G,
  §V.E, §VII) or in future-work framing (§VII).
- Federated RL attribution: correctly credited to **[14] Yu, Wynter & Lim (Springer 2022)** in
  §II.C and §V.E. Noseda [13] is used only for the volatility-classification result.
  `references.bib` carries a comment recording the earlier misattribution as forbidden.
- Superseded values **0.6744** and **0.5863**: absent everywhere. The re-measured **0.6743** and
  **0.5942** are used consistently (Table VII, Fig. 5 legend, §IV.B, §V.C).
- No marketing adjectives applied to any metric; AUC 0.6489 is never called good, strong or high.

*Numbers in the paper not present in `FACTS.md` (62 distinct decimals).* Triaged:
- **Plot furniture and rounded duplicates** (majority): axis ticks (0.0, 0.2, 0.75, 1.00, 1.50)
  and Fig. 9's 3-dp restatements of Table I's 4-dp values. Presentational only — see Minor #3.
- **Fig. 10 heatmap cells** (0.91, 0.92, 0.82, 0.78, 0.75, 0.69, 0.67, 0.65, 0.62, 0.61, 0.58,
  0.56, 0.43, 0.40, 0.34, 0.32, 0.30): all present in `results.json` `feature_corr_matrix`.
  Verified, but outside the contract.
- **Four literature values** (0.7162, 0.7295, 0.7206, 0.5366, §II.C): traced to
  `research-report/08_literature_review.md` line 45, correctly transcribed and correctly
  attributed to [13]. Legitimate; `FACTS.md` simply has no section for third-party numbers.
- **~20 generator constants** in Tables II–III and Eqs. (18)–(22): present in **neither**
  `FACTS.md` **nor** `results.json`. This is the only genuine contract gap, and it is the subject
  of critical defect **C-4**. Not fabrication — these plainly come from the generator source —
  but currently unverifiable by any reviewer, because that source is unpublished.

---

## Cross-reference and numbering audit

**Broken references: none.** `paper.log` contains zero "Reference … undefined" warnings and the
PDF contains no `??`. All 14 bibliography keys resolve; all 14 are cited at least once; no
uncited entries.

**Orphans: none.** Every figure (1–14), every table (I–XI) and every equation (1)–(28) is
referenced at least once in prose or in a caption. I checked each individually. This is better
than most accepted papers.

**Equation numbering and semantics: consistent.** Eq. (21) — the ΔCE label, `FACTS.md`'s E23 — is
cited in §I.C, §III.E (×5), §IV.B, §IV.C, §V.A, §VI, Table III, Table IX and Fig. 3's caption. In
every case the prose describes the ΔCE sign rule that (21) actually states. I found **no** instance
of a cited equation number attached to a claim the equation does not make. (Internal label names
have drifted from `FACTS.md` §10's E-numbering — `eq:e23` prints as (21), `eq:e3` and `eq:e8` are
absent — which is invisible to the reader but a maintenance hazard; see Minor #13.)

**Table numbering: correct.** Citation order is I, II, III, IV, V, VI, VII, VIII, IX, X, XI —
strictly sequential. Captions stand alone; all eleven carry explanatory footnotes.

**Figure numbering: incorrect.** First-citation order is
**1, 2, 3, 4, 14, 8, 7, 5, 6, 9, 10, 13, 11, 12** — seven figures out of sequence.

| Printed | Content | First cited | Printed on | Gap |
|---|---|---|---|---|
| Fig. 4 | FedAvg workflow | §III.G, p. 6 | p. 8 | 2 pp. |
| Fig. 14 | Aggregation arithmetic | §III.G, p. 6 | p. 15 | **9 pp.** |
| Fig. 8 | Label balance | §IV.A, p. 6 | p. 11 | 5 pp. |
| Fig. 7 | Calibration | §IV.B, p. 10 | p. 11 | 1 p. |
| Fig. 13 | Coefficients | §IV.B, p. 10 | p. 15 | **5 pp.** |
| Table I | Feature contract | §III.C, p. 4 | p. 7 | 3 pp. |

**Float density.** 25 floats over 16 pages, with four floats each on pp. 7 and 8 and four on
p. 11. Pages 7–8 are almost entirely float. Page 16 holds 100 words.

**Section cross-references: correct.** §I.D's "Organization" paragraph maps §II–§VII exactly onto
the printed section numbers.

---

## Response to the original reviewer punch-list

| Concern (`15_reviewer_comments.md`) | Status | Evidence |
|---|---|---|
| §1 — pre-frame why 0.649 is not weak | **Partial** | §V.A gives the indifference-band reading and explicitly labels it *"an interpretation rather than … a proof"*; concedes no learned-utility bound was computed. But the argument itself is unquantified — see M-2. |
| §2.1 — synthetic-only evidence (critical) | **Partial** | Bounded, not fixed. §VI ¶1–2 ("The cross-section is synthetic", "The label and the simulation share a factor model", *"this paper claims no external validity whatsoever"*), abstract, §I.C, §IV.G, §VII. Fix (c) — coefficient plausibility vs economic priors — delivered in §V.B. Fix (a) — regime holdout / perturbed-parameter validation — **not done**, and §VI says so. |
| §2.2 — federated asserted, not evaluated (critical) | **Addressed** (retitle option) | Title says "Federated-Ready"; the disclaimer appears in the abstract, C5, §III.G, §IV.G, §V.E, §VI and §VII. §V.E carries the mandated sentence. Sample-count inflation is flagged (Fig. 14 caption, §VI) but not evaluated — permitted under the retitle option. |
| §2.3 — scaler provenance (critical) | **Partial** | Disclosed §III.C with magnitudes (3.9504 / 6.2677), quantified as A4 = 0.6490 (+0.0001) in Table IX, argued at length in §V.D including *"Pinning the constants is correct; pinning the wrong constants is not."* But the punch-list asked to **regenerate and dual-report a sensitivity table**; the paper dual-reports exactly one metric (test AUC) and states regeneration is *"required engineering work that this paper does not present as complete."* |
| §2.4 — deterministic baselines B1/B2/**B3** | **Partial** | B0/B1/B2 in Table VIII with full metrics and McNemar. **B3 — the legacy heuristic scored on the same outcome labels — is missing**, and the row labels B0/B1/B2/**B5** advertise the gap. See M-3. |
| §2.5 — statistical rigor | **Addressed** | Table X: 5-fold CV (AUC and PR-AUC), bootstrap CIs for AUC and accuracy over 1,000 resamples, ECE, Brier, reference levels. Table VIII: McNemar in both directions. Wilcoxon and Hosmer–Lemeshow not run — consistent with `FACTS.md` §9, though the paper never says they were considered. |
| §2.6 — financial evaluation absent | **Addressed** | §IV.G is a dedicated "Scope of the Evaluation" subsection naming every unreported financial metric; repeated in §VI and §VII (*"No claim of superiority over a buy-and-hold or calendar policy is made or supported"*). The rejected "superiority in accuracy and flexibility" language is gone. |
| §2.7 — metric reporting | **Addressed** | Majority 0.5027, PR baseline 0.5027, AUC baseline 0.5000 all in §IV.B; Table X has a "Reference levels" block; the precision/recall asymmetry is explained via Table XI in both §IV.F and §V.F; Fig. 6's caption forces PR-AUC to be read against 0.5027. |
| §3.1 — `days` is an estimate for real users | **Addressed** | §VI: *"Elapsed time is exact only in simulation … for a real user it would be an estimate derived from transaction history and subject to error."* |
| §3.2 — calendar/trading conversion seam | **Addressed but stated backwards** | §VI names the seam, but writes the conversion in the wrong direction and contradicts Table III. See M-4. |
| §3.3 — no target heterogeneity | **Addressed** | §VI: *"Target mandates are homogeneous … no glide paths and no externally specified target weights."* |
| §3.4 — do not drift into marketing / "85–88%" | **Addressed** | Verified absent. No marketing adjectives found anywhere. |
| §3.5 — privacy wording prominent | **Addressed** (over-addressed) | Four full restatements (§III.A, §III.G, §V.E, §VII). Correct, and now redundant — see the cut list. |
| §3.6 — reproducibility artifact; **merge the generator** | **Ignored** (disclosed only) | Reproducibility section and §VI both state the generator *"currently resides on an unmerged branch and must be published alongside the artifact."* Disclosure is not the fix the punch-list demanded; it called this "unacceptable". Contributes to C-4. |
| §3.7 — missing ablations | **Addressed** | Table IX: A1 (−days), A2 (−market), A3 (−portfolio), market-only, portfolio-only, A4 (scaler refit), A5 (row shuffle). All requested variants present. |
| §5.1 — retitle framing | **Addressed** | "Federated" is not the head noun; "Federated-Ready Design" is the trailing qualifier. |
| Noseda / Yu attribution | **Addressed** | [14] Yu, Wynter & Lim carries federated RL in §II.C and §V.E; `references.bib` documents the prior misattribution as forbidden. |

**Score: 9 addressed, 6 partial, 1 ignored.** The one ignored item (merge the generator) and two
of the partials (B3 baseline; scaler dual-report) are cheap. §2.1's missing regime holdout is the
only one that is genuinely expensive, and the paper handles it by bounding the claim, which I
accept.

---

## Length and submittability

**Current: 16 pages, ~12,580 words, 25 floats, 28 equations. Target: ~6 pages.** A 6-page IEEE
double-column paper supports roughly 5,000 words *including* floats — realistically ~4,000 words
of prose plus 6–7 floats. This manuscript is **2.5× over** and carries **~4× the float budget**.
Section lengths: §III 2,373 w, §V **2,456 w**, §IV 1,822 w, §II 869 w, §I 855 w, §VI+§VII 432 w.
That §V exceeds §IV is itself the diagnosis: the discussion is longer than the experiments it
discusses.

### Tier 1 — pure duplication. Cut first; zero information is lost. (~3 pages)

1. **Fig. 9 (feature–label correlation)** — reproduces Table I's "r with y" column at *lower*
   precision. Delete the figure, keep the table.
2. **Fig. 13 (coefficients)** — reproduces Table I's "Coef." column. Delete; §V.B already
   narrates the four coefficients that matter.
3. **Fig. 12 (CV folds)** — reproduces Table X's first two rows. Delete.
4. **Fig. 8 (label balance)** — a two-bar chart for "15,026 vs 14,974", a fact already stated in
   §III.E *and* §IV.A. Delete.
5. **Fig. 14 (aggregation arithmetic)** — restates (120·0.4 + 360·0.8)/480 = 0.7, which §V.E
   writes out inline. Delete.
6. **Fig. 3 (label mechanism)** — a flowchart of Eq. (21), which §III.E narrates term by term.
   Delete.
7. **§V.F "The Operating Point"** (~350 w) — restates §IV.F nearly sentence for sentence, down to
   re-quoting 0.8750/0.5460 and 0.9907/0.5091. Delete; keep §IV.F.
8. **Table VI (datasets)** — every row already appears in prose. Fold into two sentences in §IV.A.

*Running total: 6 figures and 1 table removed, ~400 words. Approx. 3 pages.*

### Tier 2 — move to a supplement or appendix. (~3 pages)

9. **§III.D "Synthetic Data Generation" in full — Eqs. (15)–(20), Table II, Table III, Fig. 2.**
   This is the single largest block (~900 words + 3 floats + 6 equations) and, per C-4, the least
   verifiable. Keep in the main paper: the six-sentence summary, Eq. (21), and the seed. Move the
   rest to the supplement **together with the merged generator source**, which is where a reader
   who cares about it will actually check it.
10. **Table IV (model/runtime configuration)** — replace with one sentence: "lbfgs, C = 1,
    max_iter 1000; TF.js single dense sigmoid unit, Adam lr 0.05, batch 32; scikit-learn 1.7.2 /
    numpy 2.2.6 / pandas 2.3.3."
11. **Table V + Fig. 4 (FedAvg constants and workflow)** — three floats and ~600 words devoted to
    a component with no results. Compress to one paragraph naming L = 5.0, K_min = 2, cap 10,000,
    1 h throttle, versions 1/1/1, and keep Eqs. (26)–(28).
12. **Table XI (threshold sweep)** — keep the table **or** the §IV.F narration, not both. Prefer
    the table.
13. **Fig. 10 (correlation heatmap)** — supports one paragraph of §V.B. Replace with the sentence
    "correlations of 0.91 and 0.92 within the concentration family"; move the heatmap to the
    supplement.

### Tier 3 — compression. (~2 pages)

14. **Collapse the repeated disclaimers.** "The federated path is disabled and unevaluated"
    appears in the abstract, C5, §III.G, §IV.G, §V.E, §VI *and* §VII — **seven times**. The privacy
    disclaimer appears four times. Keep two of each (abstract + one dedicated paragraph). ~250 words.
15. **§V.D (scaler)** is the third full statement of the same defect after §III.C and §IV.E. Cut
    to five lines that report only the A4 delta and the pinning rationale. ~250 words.
16. **§V.E** duplicates §IV.G. Cut to three lines. ~150 words.
17. **§II** 869 → ~450 words. The prose is good but the section carries 14 references for a
    6-page paper; 8–10 is the right number.
18. **§VI** — nine one-paragraph limitations → one dense paragraph plus a three-sentence future-work
    list. ~250 words.

### What survives in a 6-page version

Fig. 1 (architecture, halved), **Fig. 11 (negative control — the paper's reason to exist)**,
Fig. 5 (ROC), Fig. 7 (calibration); Table I (features), Table VII (models), Table VIII (baselines +
McNemar), Table IX (ablations), Table X (statistical validation). Four figures, five tables — still
ambitious for 6 pages, but reachable.

### My actual recommendation on venue

Six pages is achievable only by moving the generator description out of the paper entirely, which
makes the central dataset unverifiable in the document that depends on it — the opposite of what
this manuscript is trying to be. Two honest options:

- **Submit at 8 pages** (most IEEE conferences permit 8 with over-length charges): apply Tier 1
  and Tier 3, keep §III.D in the main text, and you land at ~8 pages with 6 figures and 8 tables.
  **This is what I would do.**
- **Retarget a journal** (IEEE Access, IEEE Trans. Computational Social Systems). At 16 pages with
  25 floats this manuscript is *already* journal-shaped, and the ΔCE-distribution experiment (M-2),
  the B3 baseline (M-3) and a federated simulation would fill it out properly. The current draft
  reads like a journal paper being forced through a conference page limit.

---

## Would I accept?

Not as submitted — but I want to be clear that my objections are to four specific claims and to
the page count, not to the work. The intellectual core is sound and, more unusually, the paper is
*honest in a way I can verify*: 161 of 161 stated experimental values reproduce exactly against the
committed raw output, the re-measured cells are used consistently, the model that beats the
proposed one is reported with its p-value in the abstract's own section, the 0.9310 is explicitly
labelled as an exhibit of failure rather than a result, and the federated and privacy claims are
scoped down to nothing more than what was actually built. I checked hard for drift and found none.
That earns real credit, and it is why this is a major revision and not a reject.

What blocks acceptance is that the paper's *one* headline claim is the one place where the rigor
lapses. "Everything fixed except the label" is not true — the two arms are different corpora of
different sizes with different class balances, standardized by constants that are in-sample for
one arm and out-of-sample for the other, and the paper never says so. A manuscript whose entire
thesis is *"be careful what you attribute your accuracy to"* cannot afford a confounded causal
attribution in its own central experiment. Fix it by relabelling the same 30,000 rows with
Eq. (22) — one afternoon's work, and I expect it will *strengthen* the result.

**I would accept after:** (1) rerunning the negative control on the 30,000-row corpus and
rewording C2 / abstract / §IV.C / §VII accordingly; (2) reporting a parity measurement or demoting
C4 to a design statement and softening §V.C's "is reproducible"; (3) deleting the "ceiling" clause
in §IV.B; (4) merging and publishing the generator, and specifying Eq. (21)'s forward-shock
distributions; (5) adding baseline B3 and fixing the B0/B1/B2/B5 labels; (6) renumbering the
figures into citation order; (7) reaching ≤8 pages. Items (2), (3), (5) and (6) are hours of work.
Items (1) and (4) are the real ones, and both are engineering rather than research.

With those, I would support acceptance — and I would say so to the other reviewers.
