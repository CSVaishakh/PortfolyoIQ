"""
Generate the data-driven figures (F4-F11, F14) for the PortfolioIQ IEEE paper.

Reads paper/figures/results.json (produced by reproduce.py under the pinned
scikit-learn environment) and emits vector PDFs sized for IEEEtran.

Design constraints:
  - single-column width 3.4in, double-column 7.0in
  - serif family to match the IEEEtran body text
  - categorical palette validated colourblind-safe; every multi-series figure
    ALSO varies linestyle/hatch so identity survives greyscale printing
  - baselines (AUC 0.5, majority accuracy, PR baseline) drawn explicitly so
    "better than chance, far from oracle" is legible without reading the caption
"""

import json
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import Patch

HERE = Path(__file__).resolve().parent
FIG = HERE.parent / "figures"
RES = json.load(open(FIG / "results.json"))

# validated categorical palette (see dataviz validator: all six checks pass)
BLUE, ORANGE, TEAL, PURPLE = "#1f5fbf", "#d1670a", "#00917c", "#8b3fa8"
INK, MUTED, GRID = "#1a1a1a", "#5c5c5c", "#d5d5d5"

plt.rcParams.update(
    {
        "font.family": "serif",
        "font.serif": ["DejaVu Serif"],
        "mathtext.fontset": "dejavuserif",
        "font.size": 7.5,
        "axes.labelsize": 7.5,
        "axes.titlesize": 8,
        "legend.fontsize": 6.8,
        "xtick.labelsize": 7,
        "ytick.labelsize": 7,
        "axes.edgecolor": MUTED,
        "axes.linewidth": 0.6,
        "xtick.color": MUTED,
        "ytick.color": MUTED,
        "text.color": INK,
        "axes.labelcolor": INK,
        "grid.color": GRID,
        "grid.linewidth": 0.5,
        "figure.dpi": 200,
        "savefig.bbox": "tight",
        "savefig.pad_inches": 0.02,
        "pdf.fonttype": 42,
    }
)

SINGLE, DOUBLE = 3.4, 7.0
PRETTY = {
    "num_stocks": "num stocks",
    "max_stock_weight": "max stock weight",
    "top3_concentration": "top-3 concentration",
    "total_weight_drift": "total weight drift",
    "portfolio_return": "portfolio return",
    "portfolio_volatility": "portfolio volatility",
    "sector_concentration": "sector concentration",
    "days_since_last_rebalance": "days since rebalance",
    "market_return_30d": "market return 30d",
    "market_volatility_30d": "market volatility 30d",
    "market_drawdown_90d": "market drawdown 90d",
    "market_trend": "market trend",
}


def tidy(ax, grid_axis="y"):
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.grid(True, axis=grid_axis, alpha=0.7, zorder=0)
    ax.set_axisbelow(True)


def save(fig, name):
    out = FIG / f"{name}.pdf"
    fig.savefig(out)
    plt.close(fig)
    print("wrote", out.name)


# ---------------------------------------------------------------- F4
def f4_label_balance():
    d = RES["dataset"]
    fig, ax = plt.subplots(figsize=(SINGLE, 1.85))
    vals = [d["negatives"], d["positives"]]
    bars = ax.bar(
        ["Hold ($y=0$)", "Rebalance ($y=1$)"],
        vals,
        color=[MUTED, BLUE],
        width=0.5,
        zorder=3,
    )
    bars[0].set_hatch("//")
    bars[0].set_edgecolor("white")
    for b, v in zip(bars, vals):
        ax.text(
            b.get_x() + b.get_width() / 2,
            v + 260,
            f"{v:,}\n({v / d['rows']:.4f})",
            ha="center",
            va="bottom",
            fontsize=6.8,
        )
    ax.set_ylabel("rows")
    ax.set_ylim(0, max(vals) * 1.30)
    tidy(ax)
    save(fig, "f4_label_balance")


# ---------------------------------------------------------------- F5
def f5_feature_corr():
    fs = sorted(RES["feature_stats"], key=lambda r: r["corr_label"])
    names = [PRETTY[r["name"]] for r in fs]
    vals = [r["corr_label"] for r in fs]
    fig, ax = plt.subplots(figsize=(SINGLE, 2.5))
    cols = [BLUE if v >= 0 else ORANGE for v in vals]
    ax.barh(names, vals, color=cols, height=0.62, zorder=3)
    for i, v in enumerate(vals):
        ax.text(
            v + (0.004 if v >= 0 else -0.004),
            i,
            f"{v:+.3f}",
            va="center",
            ha="left" if v >= 0 else "right",
            fontsize=6.2,
        )
    ax.axvline(0, color=MUTED, lw=0.7)
    ax.set_xlabel(r"Pearson $r$ with rebalancing label")
    ax.set_xlim(-0.06, 0.245)
    tidy(ax, grid_axis="x")
    save(fig, "f5_feature_corr")


# ---------------------------------------------------------------- F6
def f6_roc():
    roc = RES["curves"]["roc"]
    order = [("LR", BLUE, "-"), ("RF", ORANGE, "--"),
             ("GB", TEAL, "-."), ("SVM-RBF", PURPLE, (0, (3, 1, 1, 1)))]
    fig, ax = plt.subplots(figsize=(SINGLE, 2.6))
    ax.plot([0, 1], [0, 1], color=MUTED, lw=0.8, ls=":", zorder=2)
    ax.text(0.62, 0.545, "chance (AUC 0.500)", fontsize=6.2,
            color=MUTED, rotation=34, ha="center", va="bottom")
    for name, col, ls in order:
        c = roc[name]
        ax.plot(c["fpr"], c["tpr"], color=col, lw=1.4, ls=ls, zorder=3,
                label=f"{name} (AUC {c['auc']:.4f})")
    ax.set_xlabel("false positive rate")
    ax.set_ylabel("true positive rate")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="lower right", frameon=False, handlelength=2.4)
    tidy(ax, grid_axis="both")
    save(fig, "f6_roc")


# ---------------------------------------------------------------- F7
def f7_pr():
    pr = RES["curves"]["pr"]
    fig, ax = plt.subplots(figsize=(SINGLE, 2.3))
    ax.plot(pr["recall"], pr["precision"], color=BLUE, lw=1.5, zorder=3,
            label=f"LR (PR-AUC {pr['pr_auc']:.4f})")
    ax.axhline(pr["baseline"], color=ORANGE, lw=1.0, ls="--", zorder=2,
               label=f"baseline ({pr['baseline']:.4f})")
    ax.set_xlabel("recall")
    ax.set_ylabel("precision")
    ax.set_xlim(0, 1)
    ax.set_ylim(0.4, 1.0)
    ax.legend(loc="upper right", frameon=False)
    tidy(ax, grid_axis="both")
    save(fig, "f7_pr")


# ---------------------------------------------------------------- F8
def f8_calibration():
    cal = RES["calibration_bins"]
    xs = [c["mean_pred"] for c in cal]
    ys = [c["frac_pos"] for c in cal]
    ns = [c["count"] for c in cal]
    t = RES["primary"]["test"]
    fig, (ax, ax2) = plt.subplots(
        2, 1, figsize=(SINGLE, 2.9), sharex=True,
        gridspec_kw={"height_ratios": [3, 1], "hspace": 0.12},
    )
    ax.plot([0, 1], [0, 1], color=MUTED, lw=0.8, ls=":", zorder=2,
            label="perfect calibration")
    ax.plot(xs, ys, color=BLUE, lw=1.4, marker="o", ms=3.4, zorder=3,
            label=f"LR (ECE {t['ece']:.4f}, Brier {t['brier']:.4f})")
    ax.set_ylabel("observed frequency")
    ax.set_xlim(0, 1)
    ax.set_ylim(0, 1)
    ax.legend(loc="upper left", frameon=False)
    tidy(ax, grid_axis="both")
    ax2.bar(xs, ns, width=0.075, color=MUTED, zorder=3)
    ax2.set_ylabel("count", fontsize=6.5)
    ax2.set_xlabel("predicted probability")
    tidy(ax2)
    save(fig, "f8_calibration")


# ---------------------------------------------------------------- F9
def f9_heatmap():
    m = np.array(RES["feature_corr_matrix"])
    labs = [PRETTY[f] for f in RES["feature_names"]]
    fig, ax = plt.subplots(figsize=(SINGLE, 3.05))
    im = ax.imshow(m, cmap="RdBu_r", vmin=-1, vmax=1)
    ax.set_xticks(range(len(labs)))
    ax.set_yticks(range(len(labs)))
    ax.set_xticklabels(labs, rotation=90, fontsize=5.6)
    ax.set_yticklabels(labs, fontsize=5.6)
    for i in range(len(labs)):
        for j in range(len(labs)):
            if abs(m[i, j]) >= 0.30 and i != j:
                ax.text(j, i, f"{m[i, j]:.2f}", ha="center", va="center",
                        fontsize=4.6,
                        color="white" if abs(m[i, j]) > 0.62 else INK)
    cb = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.03)
    cb.ax.tick_params(labelsize=6)
    cb.set_label(r"Pearson $r$", fontsize=6.5)
    cb.outline.set_linewidth(0.5)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.tick_params(length=0)
    save(fig, "f9_corr_heatmap")


# ---------------------------------------------------------------- F10
def f10_coefficients():
    fs = RES["feature_stats"]
    order = sorted(fs, key=lambda r: r["coef"])
    names = [PRETTY[r["name"]] for r in order]
    vals = [r["coef"] for r in order]
    fig, ax = plt.subplots(figsize=(SINGLE, 2.5))
    cols = [BLUE if v >= 0 else ORANGE for v in vals]
    ax.barh(names, vals, color=cols, height=0.62, zorder=3)
    for i, v in enumerate(vals):
        ax.text(v + (0.03 if v >= 0 else -0.03), i, f"{v:+.4f}",
                va="center", ha="left" if v >= 0 else "right", fontsize=6.2)
    ax.axvline(0, color=MUTED, lw=0.7)
    ax.set_xlabel("coefficient (standardized units)")
    ax.set_xlim(-0.55, 1.52)
    tidy(ax, grid_axis="x")
    save(fig, "f10_coefficients")


# ---------------------------------------------------------------- F11
def f11_negative_control():
    mc = RES["matched_control"]
    prim = RES["primary"]["test"]["auc"]
    fig, (ax, ax2) = plt.subplots(1, 2, figsize=(SINGLE, 2.35),
                                  gridspec_kw={"wspace": 0.62})
    labs = ["rule\nlabels", "backtest\nlabels"]
    xs = [0, 1]

    vals = [mc["test_auc"], prim]
    bars = ax.bar(xs, vals, color=[ORANGE, BLUE], width=0.56, zorder=3)
    bars[0].set_hatch("//")
    bars[0].set_edgecolor("white")
    for x, v in zip(xs, vals):
        ax.text(x, v + 0.016, f"{v:.4f}", ha="center", fontsize=7)
    # chance reference: the dotted line is named in the caption, not on-plot
    ax.axhline(0.5, color=MUTED, lw=0.9, ls=":", zorder=2)
    # gap-centred delta arrow, label stacked above it so nothing overlaps a bar
    ax.annotate("", xy=(0.5, vals[1]), xytext=(0.5, vals[0]),
                arrowprops=dict(arrowstyle="<->", lw=0.8, color=INK))
    ax.text(0.5, vals[0] + 0.030, f"$\\Delta$ {vals[0] - vals[1]:.3f}",
            fontsize=6.8, va="bottom", ha="center")
    ax.set_ylabel("test ROC-AUC")
    ax.set_ylim(0.4, 1.04)
    ax.set_xlim(-0.6, 1.6)
    ax.set_xticks(xs)
    ax.set_xticklabels(labs)
    tidy(ax)

    cv = [abs(mc["corr_days_label"]),
          abs(RES["negative_control"]["corr_days_label_backtest"])]
    b2 = ax2.bar(xs, cv, color=[ORANGE, BLUE], width=0.56, zorder=3)
    b2[0].set_hatch("//")
    b2[0].set_edgecolor("white")
    for x, v in zip(xs, cv):
        ax2.text(x, v + 0.013, f"{v:.4f}", ha="center", fontsize=7)
    ax2.set_ylabel(r"$|\mathrm{corr}(\mathrm{days},\,y)|$")
    ax2.set_ylim(0, 0.50)
    ax2.set_xlim(-0.6, 1.6)
    ax2.set_xticks(xs)
    ax2.set_xticklabels(labs)
    tidy(ax2)
    save(fig, "f11_negative_control")


# ---------------------------------------------------------------- F14
def f14_cv():
    cv = RES["cv5"]
    folds = cv["auc_folds"]
    mean, sd = cv["auc_mean"], cv["auc_std"]
    fig, ax = plt.subplots(figsize=(SINGLE, 1.95))
    xs = np.arange(1, len(folds) + 1)
    ax.axhspan(mean - sd, mean + sd, color=BLUE, alpha=0.13, zorder=1)
    ax.axhline(mean, color=BLUE, lw=1.1, zorder=2,
               label=f"mean {mean:.4f} $\\pm$ {sd:.4f}")
    ax.plot(xs, folds, "o", color=BLUE, ms=5, zorder=3)
    for x, v in zip(xs, folds):
        ax.text(x, v + 0.0028, f"{v:.4f}", ha="center", fontsize=6.2)
    ax.axhline(RES["primary"]["test"]["auc"], color=ORANGE, lw=1.0, ls="--",
               zorder=2, label=f"held-out test {RES['primary']['test']['auc']:.4f}")
    ax.set_xticks(xs)
    ax.set_xlabel("cross-validation fold")
    ax.set_ylabel("ROC-AUC")
    ax.set_xlim(0.5, 5.5)
    ax.set_ylim(min(folds) - 0.011, max(folds) + 0.011)
    ax.legend(loc="lower right", frameon=False, fontsize=6.2)
    tidy(ax)
    save(fig, "f14_cv_folds")


if __name__ == "__main__":
    f4_label_balance()
    f5_feature_corr()
    f6_roc()
    f7_pr()
    f8_calibration()
    f9_heatmap()
    f10_coefficients()
    f11_negative_control()
    f14_cv()
    print("all data-driven figures written")
