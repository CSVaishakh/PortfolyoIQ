"""
PortfolioIQ — reproduction of every numeric claim in the IEEE paper.

Runs under the repository's pinned environment
(scikit-learn 1.7.2, numpy 2.2.6, pandas 2.3.3).

Protocol is fixed by the dossier:
  - dataset: apps/model-service/demo-dataset.csv (30,000 rows, 12 features)
  - control: apps/model-service/dataset.csv     (5,000 rows, heuristic labels)
  - scaler : packages/model-contract/feature-spec.json (legacy-5k derived)
  - split  : source-row-order 60/20/20, matching main.py:129-132
  - threshold: 0.5

Emits results.json consumed by make_figures.py and by the LaTeX tables.
Nothing here is invented: every quantity is computed from the committed data.
"""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    average_precision_score,
    balanced_accuracy_score,
    brier_score_loss,
    f1_score,
    matthews_corrcoef,
    precision_recall_curve,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import cross_val_score
from sklearn.svm import SVC

ROOT = Path(__file__).resolve().parents[2]
MODEL_SVC = ROOT / "apps" / "model-service"
SPEC_PATH = ROOT / "packages" / "model-contract" / "feature-spec.json"
OUT = Path(__file__).resolve().parent.parent / "figures" / "results.json"

RNG_SEED = 20260804


# ----------------------------------------------------------------------------
# data
# ----------------------------------------------------------------------------
def load(spec, csv_name):
    df = pd.read_csv(MODEL_SVC / csv_name)
    feats = spec["featureNames"]
    X = df[feats].values.astype(float)
    y = df["rebalancing_label"].values.astype(int)
    return df, X, y


def standardize(X, mu, sd):
    return np.where(sd < 1e-9, 0.0, (X - mu) / sd)


def split_idx(n):
    return int(n * 0.6), int(n * 0.8)


# ----------------------------------------------------------------------------
# metrics
# ----------------------------------------------------------------------------
def ece(y_true, p, bins=10):
    """Expected calibration error, 10 equal-width bins (main.py:35-44)."""
    edges = np.linspace(0.0, 1.0, bins + 1)
    n = len(y_true)
    total = 0.0
    for b in range(bins):
        lo, hi = edges[b], edges[b + 1]
        m = (p > lo) & (p <= hi) if b > 0 else (p >= lo) & (p <= hi)
        if m.sum() == 0:
            continue
        total += (m.sum() / n) * abs(p[m].mean() - y_true[m].mean())
    return float(total)


def full_metrics(y_true, p, threshold=0.5):
    pred = (p >= threshold).astype(int)
    return {
        "auc": float(roc_auc_score(y_true, p)),
        "pr_auc": float(average_precision_score(y_true, p)),
        "accuracy": float(accuracy_score(y_true, pred)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "mcc": float(matthews_corrcoef(y_true, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, pred)),
        "brier": float(brier_score_loss(y_true, p)),
        "ece": ece(y_true, p),
    }


def hard_metrics(y_true, pred):
    """Metrics for a deterministic rule (no probability score)."""
    return {
        "auc": float(roc_auc_score(y_true, pred)),
        "accuracy": float(accuracy_score(y_true, pred)),
        "precision": float(precision_score(y_true, pred, zero_division=0)),
        "recall": float(recall_score(y_true, pred, zero_division=0)),
        "f1": float(f1_score(y_true, pred, zero_division=0)),
        "mcc": float(matthews_corrcoef(y_true, pred)),
        "balanced_accuracy": float(balanced_accuracy_score(y_true, pred)),
    }


def mcnemar_exact(y_true, pred_a, pred_b):
    """Exact binomial McNemar test on paired hard labels."""
    a_ok, b_ok = (pred_a == y_true), (pred_b == y_true)
    n01 = int(np.sum(a_ok & ~b_ok))   # A right, B wrong
    n10 = int(np.sum(~a_ok & b_ok))   # A wrong, B right
    n = n01 + n10
    if n == 0:
        return {"n01": n01, "n10": n10, "p_value": 1.0}
    # two-sided exact binomial test at p=0.5 (log-space: n can be large)
    from scipy.stats import binomtest

    p = binomtest(min(n01, n10), n, 0.5, alternative="two-sided").pvalue
    return {"n01": n01, "n10": n10, "p_value": float(p)}


def bootstrap_ci(y_true, p, n_boot=1000, seed=RNG_SEED):
    """Percentile bootstrap 95% CI for test AUC and accuracy."""
    rng = np.random.default_rng(seed)
    n = len(y_true)
    aucs, accs = [], []
    pred = (p >= 0.5).astype(int)
    for _ in range(n_boot):
        idx = rng.integers(0, n, n)
        yt = y_true[idx]
        if yt.min() == yt.max():
            continue
        aucs.append(roc_auc_score(yt, p[idx]))
        accs.append(accuracy_score(yt, pred[idx]))
    q = lambda a: [float(np.percentile(a, 2.5)), float(np.percentile(a, 97.5))]
    return {
        "n_boot": int(len(aucs)),
        "auc_mean": float(np.mean(aucs)),
        "auc_ci95": q(aucs),
        "acc_mean": float(np.mean(accs)),
        "acc_ci95": q(accs),
    }


# ----------------------------------------------------------------------------
def main():
    spec = json.load(open(SPEC_PATH))
    feats = spec["featureNames"]
    mu = np.array(spec["scalerMean"])
    sd = np.array(spec["scalerStd"])

    res = {
        "environment": {},
        "feature_names": feats,
        "scaler_shipped": {"mean": list(map(float, mu)), "std": list(map(float, sd))},
    }

    import sklearn

    res["environment"] = {
        "sklearn": sklearn.__version__,
        "numpy": np.__version__,
        "pandas": pd.__version__,
    }

    # ---------------- primary dataset ----------------
    df, X, y = load(spec, "demo-dataset.csv")
    Xs = standardize(X, mu, sd)
    te, ve = split_idx(len(y))

    res["dataset"] = {
        "rows": int(len(y)),
        "features": len(feats),
        "n_train": int(te),
        "n_val": int(ve - te),
        "n_test": int(len(y) - ve),
        "positives": int(y.sum()),
        "negatives": int(len(y) - y.sum()),
        "positive_rate": float(y.mean()),
        "test_positive_rate": float(y[ve:].mean()),
    }

    ytr, yva, yte = y[:te], y[te:ve], y[ve:]

    # ---------------- primary model: LR C=1 ----------------
    lr = LogisticRegression(max_iter=1000).fit(Xs[:te], ytr)
    p_va = lr.predict_proba(Xs[te:ve])[:, 1]
    p_te = lr.predict_proba(Xs[ve:])[:, 1]

    res["primary"] = {
        "val_auc": float(roc_auc_score(yva, p_va)),
        "test": full_metrics(yte, p_te),
        "coef": [float(c) for c in lr.coef_[0]],
        "intercept": float(lr.intercept_[0]),
    }

    # majority-class baseline on the test split
    maj = int(round(ytr.mean()))
    res["baselines"] = {
        "majority": {
            "accuracy": float(accuracy_score(yte, np.full_like(yte, maj))),
            "auc": 0.5,
            "pr_baseline": float(yte.mean()),
        }
    }

    # ---------------- cross-validation ----------------
    cv = cross_val_score(
        LogisticRegression(max_iter=1000), Xs, y, cv=5, scoring="roc_auc"
    )
    cv_pr = cross_val_score(
        LogisticRegression(max_iter=1000), Xs, y, cv=5, scoring="average_precision"
    )
    res["cv5"] = {
        "auc_folds": [float(v) for v in cv],
        "auc_mean": float(cv.mean()),
        "auc_std": float(cv.std()),
        "pr_folds": [float(v) for v in cv_pr],
        "pr_mean": float(cv_pr.mean()),
        "pr_std": float(cv_pr.std()),
    }

    # ---------------- model comparison ----------------
    models = {}

    for name, C in [("LR C=0.1", 0.1), ("LR C=10", 10.0)]:
        m = LogisticRegression(max_iter=1000, C=C).fit(Xs[:te], ytr)
        pv = m.predict_proba(Xs[te:ve])[:, 1]
        pt = m.predict_proba(Xs[ve:])[:, 1]
        models[name] = {
            "val_auc": float(roc_auc_score(yva, pv)),
            "test_auc": float(roc_auc_score(yte, pt)),
            "test_acc": float(accuracy_score(yte, (pt >= 0.5).astype(int))),
        }

    rf = RandomForestClassifier(
        n_estimators=200, max_depth=8, random_state=RNG_SEED, n_jobs=-1
    ).fit(Xs[:te], ytr)
    gb = GradientBoostingClassifier(
        n_estimators=200, max_depth=3, random_state=RNG_SEED
    ).fit(Xs[:te], ytr)
    svm = CalibratedClassifierCV(SVC(C=1.0, kernel="rbf"), cv=3).fit(Xs[:te], ytr)

    curve_scores = {"LR": p_te}
    for name, m in [("RF", rf), ("GB", gb), ("SVM-RBF", svm)]:
        pv = m.predict_proba(Xs[te:ve])[:, 1]
        pt = m.predict_proba(Xs[ve:])[:, 1]
        models[name] = {
            "val_auc": float(roc_auc_score(yva, pv)),
            "test_auc": float(roc_auc_score(yte, pt)),
            "test_acc": float(accuracy_score(yte, (pt >= 0.5).astype(int))),
        }
        curve_scores[name] = pt

    # raw (unstandardized) logistic regression
    lr_raw = LogisticRegression(max_iter=1000).fit(X[:te], ytr)
    pt_raw = lr_raw.predict_proba(X[ve:])[:, 1]
    models["LR raw"] = {
        "val_auc": float(roc_auc_score(yva, lr_raw.predict_proba(X[te:ve])[:, 1])),
        "test_auc": float(roc_auc_score(yte, pt_raw)),
        "test_acc": float(accuracy_score(yte, (pt_raw >= 0.5).astype(int))),
    }
    res["models"] = models

    # ---------------- negative control: legacy heuristic labels ----------------
    dfl, Xl, yl = load(spec, "dataset.csv")
    Xls = standardize(Xl, mu, sd)
    tel, vel = split_idx(len(yl))
    lrl = LogisticRegression(max_iter=1000).fit(Xls[:tel], yl[:tel])
    pl_va = lrl.predict_proba(Xls[tel:vel])[:, 1]
    pl_te = lrl.predict_proba(Xls[vel:])[:, 1]

    d_idx = feats.index("days_since_last_rebalance")
    res["negative_control"] = {
        "rows": int(len(yl)),
        "val_auc": float(roc_auc_score(yl[tel:vel], pl_va)),
        "test_auc": float(roc_auc_score(yl[vel:], pl_te)),
        "test_acc": float(
            accuracy_score(yl[vel:], (pl_te >= 0.5).astype(int))
        ),
        "positive_rate": float(yl.mean()),
        "corr_days_label_rule": float(np.corrcoef(Xl[:, d_idx], yl)[0, 1]),
        "corr_days_label_backtest": float(np.corrcoef(X[:, d_idx], y)[0, 1]),
    }

    # ---------------- matched negative control ----------------
    # Relabel the SAME 30,000 feature rows with the legacy heuristic
    # (featureEngineering.ts: computeLabelScore / softTimeScore) so that the
    # degeneracy comparison varies ONLY the label function: identical rows,
    # identical features, identical scaler, identical split, identical model.
    def heuristic_label(row):
        (_, w_max, top3, drift, _, p_vol, sect, days, _, m_vol, m_dd, m_tr) = row

        z = (days - 60.0) / 40.0
        t_score = 2.5 * (2.0 / (1.0 + math.exp(-z)) - 1.0)

        d = 0.0
        if drift > 0.80:
            d += 1.2
        elif drift > 0.50:
            d += 0.6
        elif drift < 0.20:
            d -= 0.8

        if w_max > 0.55:
            d += 0.8
        elif w_max > 0.40:
            d += 0.3
        elif w_max < 0.15:
            d -= 0.5

        if sect > 0.75:
            d += 0.8
        elif sect > 0.55:
            d += 0.3
        elif sect < 0.25:
            d -= 0.4

        if m_dd < -0.20:
            d += 0.6
        elif m_dd < -0.10:
            d += 0.3
        elif m_dd > 0.05:
            d -= 0.4

        if m_tr == 0:
            d -= 0.4

        if m_vol > 0.025:
            d += 0.5
        elif m_vol < 0.008:
            d -= 0.3

        if p_vol > 0.025:
            d += 0.4
        elif p_vol < 0.005:
            d -= 0.2

        if top3 > 0.85:
            d += 0.4

        score = max(-2.5, min(2.5, t_score)) + max(-2.5, min(2.5, d))
        return 1 if 1.0 / (1.0 + math.exp(-score)) >= 0.5 else 0

    y_rule = np.array([heuristic_label(r) for r in X], dtype=int)
    lr_rule = LogisticRegression(max_iter=1000).fit(Xs[:te], y_rule[:te])
    p_rule_va = lr_rule.predict_proba(Xs[te:ve])[:, 1]
    p_rule_te = lr_rule.predict_proba(Xs[ve:])[:, 1]

    res["matched_control"] = {
        "description": (
            "same 30,000 rows and features; only the label function differs"
        ),
        "rows": int(len(y_rule)),
        "positive_rate": float(y_rule.mean()),
        "val_auc": float(roc_auc_score(y_rule[te:ve], p_rule_va)),
        "test_auc": float(roc_auc_score(y_rule[ve:], p_rule_te)),
        "test_acc": float(
            accuracy_score(y_rule[ve:], (p_rule_te >= 0.5).astype(int))
        ),
        "corr_days_label": float(np.corrcoef(X[:, d_idx], y_rule)[0, 1]),
        "agreement_with_backtest": float((y_rule == y).mean()),
    }

    # ---------------- feature diagnostics ----------------
    res["feature_stats"] = []
    for i, f in enumerate(feats):
        solo = LogisticRegression(max_iter=1000).fit(Xs[:te, [i]], ytr)
        solo_auc = float(
            roc_auc_score(yte, solo.predict_proba(Xs[ve:, [i]])[:, 1])
        )
        res["feature_stats"].append(
            {
                "name": f,
                "mean": float(X[:, i].mean()),
                "std": float(X[:, i].std(ddof=0)),
                "corr_label": float(np.corrcoef(X[:, i], y)[0, 1]),
                "solo_auc": solo_auc,
                "coef": float(lr.coef_[0][i]),
            }
        )

    corr = np.corrcoef(X.T)
    res["feature_corr_matrix"] = [[float(v) for v in row] for row in corr]

    # ---------------- rule baselines (dossier 11.3 definitions) ----------------
    days_te = X[ve:, feats.index("days_since_last_rebalance")]
    drift_te = X[ve:, feats.index("total_weight_drift")]
    wmax_te = X[ve:, feats.index("max_stock_weight")]

    b1 = (days_te >= 90).astype(int)                       # calendar 90-day rule
    b2 = ((drift_te > 0.20) & (wmax_te > 0.35)).astype(int)  # band trigger

    res["baselines"]["B1_time_90d"] = hard_metrics(yte, b1)
    res["baselines"]["B2_band_trigger"] = hard_metrics(yte, b2)
    # B3: the legacy heuristic itself, scored against the BACKTESTED labels
    res["baselines"]["B3_heuristic_rule"] = hard_metrics(yte, y_rule[ve:])

    lr_pred = (p_te >= 0.5).astype(int)
    res["mcnemar_b3"] = mcnemar_exact(yte, lr_pred, y_rule[ve:])
    res["mcnemar"] = {
        "LR_vs_B1": mcnemar_exact(yte, lr_pred, b1),
        "LR_vs_B2": mcnemar_exact(yte, lr_pred, b2),
        "LR_vs_RF": mcnemar_exact(
            yte, lr_pred, (curve_scores["RF"] >= 0.5).astype(int)
        ),
        "LR_vs_GB": mcnemar_exact(
            yte, lr_pred, (curve_scores["GB"] >= 0.5).astype(int)
        ),
        "LR_vs_majority": mcnemar_exact(yte, lr_pred, np.full_like(yte, maj)),
    }

    # ---------------- bootstrap CI ----------------
    res["bootstrap"] = bootstrap_ci(yte, p_te)

    # ---------------- threshold sweep (A7) ----------------
    res["threshold_sweep"] = []
    for t in [0.3, 0.4, 0.5, 0.6, 0.7]:
        pred = (p_te >= t).astype(int)
        res["threshold_sweep"].append(
            {
                "threshold": t,
                "accuracy": float(accuracy_score(yte, pred)),
                "precision": float(precision_score(yte, pred, zero_division=0)),
                "recall": float(recall_score(yte, pred, zero_division=0)),
                "f1": float(f1_score(yte, pred, zero_division=0)),
            }
        )

    # ---------------- ablations (A1-A5, A8) ----------------
    def fit_auc(cols, Xsrc=Xs):
        m = LogisticRegression(max_iter=1000).fit(Xsrc[:te][:, cols], ytr)
        return float(roc_auc_score(yte, m.predict_proba(Xsrc[ve:][:, cols])[:, 1]))

    all_c = list(range(len(feats)))
    market_c = [i for i, f in enumerate(feats) if f.startswith("market_")]
    port_c = [i for i in all_c if i not in market_c and i != d_idx]

    abl = {}
    abl["full"] = res["primary"]["test"]["auc"]
    abl["minus_days"] = fit_auc([i for i in all_c if i != d_idx])
    abl["minus_market"] = fit_auc([i for i in all_c if i not in market_c])
    abl["minus_portfolio"] = fit_auc([i for i in all_c if i not in port_c])
    abl["market_only"] = fit_auc(market_c)
    abl["portfolio_only"] = fit_auc(port_c)

    # A4: scaler refit on the 30k training split
    mu30 = X[:te].mean(axis=0)
    sd30 = X[:te].std(axis=0, ddof=0)
    Xs30 = standardize(X, mu30, sd30)
    abl["scaler_refit_30k"] = fit_auc(all_c, Xs30)
    res["scaler_refit"] = {
        "mean": [float(v) for v in mu30],
        "std": [float(v) for v in sd30],
        "mean_abs_diff": [float(abs(a - b)) for a, b in zip(mu30, mu)],
        "std_abs_diff": [float(abs(a - b)) for a, b in zip(sd30, sd)],
        "test_auc": abl["scaler_refit_30k"],
    }

    # A5: row shuffle before the split
    rng = np.random.default_rng(RNG_SEED)
    perm = rng.permutation(len(y))
    Xp, yp = Xs[perm], y[perm]
    ms = LogisticRegression(max_iter=1000).fit(Xp[:te], yp[:te])
    abl["row_shuffled_split"] = float(
        roc_auc_score(yp[ve:], ms.predict_proba(Xp[ve:])[:, 1])
    )
    res["ablations"] = abl

    # ---------------- curve data for figures ----------------
    curves = {}
    for name, sc in curve_scores.items():
        fpr, tpr, _ = roc_curve(yte, sc)
        k = max(1, len(fpr) // 600)
        curves[name] = {
            "fpr": [float(v) for v in fpr[::k]] + [1.0],
            "tpr": [float(v) for v in tpr[::k]] + [1.0],
            "auc": float(roc_auc_score(yte, sc)),
        }
    prec, rec, _ = precision_recall_curve(yte, p_te)
    k = max(1, len(prec) // 600)
    res["curves"] = {
        "roc": curves,
        "pr": {
            "precision": [float(v) for v in prec[::k]],
            "recall": [float(v) for v in rec[::k]],
            "pr_auc": res["primary"]["test"]["pr_auc"],
            "baseline": float(yte.mean()),
        },
    }

    # calibration bins
    bins = np.linspace(0, 1, 11)
    cal = []
    for b in range(10):
        lo, hi = bins[b], bins[b + 1]
        m = (p_te > lo) & (p_te <= hi) if b > 0 else (p_te >= lo) & (p_te <= hi)
        if m.sum() == 0:
            continue
        cal.append(
            {
                "bin_lo": float(lo),
                "bin_hi": float(hi),
                "count": int(m.sum()),
                "mean_pred": float(p_te[m].mean()),
                "frac_pos": float(yte[m].mean()),
            }
        )
    res["calibration_bins"] = cal

    OUT.parent.mkdir(parents=True, exist_ok=True)
    json.dump(res, open(OUT, "w"), indent=2)

    # ---------------- console summary ----------------
    pm = res["primary"]
    print(f"env: sklearn {res['environment']['sklearn']}")
    print(
        "PRIMARY  valAUC %.4f testAUC %.4f acc %.4f prec %.4f rec %.4f F1 %.4f "
        "MCC %.4f balAcc %.4f Brier %.4f PR %.4f ECE %.4f"
        % (
            pm["val_auc"],
            pm["test"]["auc"],
            pm["test"]["accuracy"],
            pm["test"]["precision"],
            pm["test"]["recall"],
            pm["test"]["f1"],
            pm["test"]["mcc"],
            pm["test"]["balanced_accuracy"],
            pm["test"]["brier"],
            pm["test"]["pr_auc"],
            pm["test"]["ece"],
        )
    )
    print(
        "CV5 %s mean %.4f sd %.4f"
        % (
            np.round(res["cv5"]["auc_folds"], 4),
            res["cv5"]["auc_mean"],
            res["cv5"]["auc_std"],
        )
    )
    print("MODELS", json.dumps(models, indent=1))
    print("NEG CONTROL", json.dumps(res["negative_control"], indent=1))
    print("ABLATIONS", json.dumps(abl, indent=1))
    print("BASELINES", json.dumps(res["baselines"], indent=1))
    print("BOOTSTRAP", json.dumps(res["bootstrap"], indent=1))
    print("MCNEMAR", json.dumps(res["mcnemar"], indent=1))
    print(f"\nwrote {OUT}")


if __name__ == "__main__":
    main()
