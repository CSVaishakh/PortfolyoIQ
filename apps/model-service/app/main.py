from fastapi import FastAPI, Request, HTTPException
from .model import GlobalModel
import pandas as pd
import numpy as np
import os

app = FastAPI()
model = GlobalModel()

@app.post("/train")
async def train(req: Request):
    body = await req.json()
    X = np.array(body["X"], dtype=float)
    y = np.array(body["y"], dtype=int)
    model.train(X, y)

    return {
        "status": 200,
        "message": "Model Training Completed"
    }

FEATURE_COLS = [
    "num_stocks", "max_stock_weight", "top3_concentration",
    "total_weight_drift", "portfolio_return", "portfolio_volatility",
    "sector_concentration", "days_since_last_rebalance",
    "market_return_30d", "market_volatility_30d",
    "market_drawdown_90d", "market_trend",
]

# ── Shared feature scaler ────────────────────────────────────────────────────
# FIXED transform derived from dataset.csv, mirrored verbatim in
# apps/react-client/lib/featureEngineering.ts (SCALER_MEAN / SCALER_STD).
# Every side — the browser (TF.js) and this service (sklearn) — standardizes
# with these exact constants, so weights live in one comparable space and
# FedAvg never mixes scaled with unscaled models. Raw magnitudes no longer
# dictate gradient size, which is what previously collapsed the model onto
# `days_since_last_rebalance` and `total_weight_drift`.
SCALER_MEAN = np.array([
    8.952400,   # num_stocks
    0.359684,   # max_stock_weight
    0.564518,   # top3_concentration
    0.432519,   # total_weight_drift
    0.059413,   # portfolio_return
    0.020793,   # portfolio_volatility
    0.524913,   # sector_concentration
    125.8444,   # days_since_last_rebalance
    -0.000101,  # market_return_30d
    0.027868,   # market_volatility_30d
    -0.182608,  # market_drawdown_90d
    0.498600,   # market_trend
])

SCALER_STD = np.array([
    3.763425,   # num_stocks
    0.166928,   # max_stock_weight
    0.250468,   # top3_concentration
    0.237506,   # total_weight_drift
    0.208244,   # portfolio_return
    0.011298,   # portfolio_volatility
    0.226788,   # sector_concentration
    73.296687,  # days_since_last_rebalance
    0.069579,   # market_return_30d
    0.015645,   # market_volatility_30d
    0.138651,   # market_drawdown_90d
    0.500048,   # market_trend
])


def standardize(X: np.ndarray) -> np.ndarray:
    """Standardize with the shared constants; zero-std columns map to 0."""
    X = np.asarray(X, dtype=float)
    return np.where(SCALER_STD < 1e-9, 0.0, (X - SCALER_MEAN) / SCALER_STD)


@app.post("/train/dataset")
async def train_from_dataset():
    csv_path = os.path.join(os.path.dirname(__file__), "..", "dataset.csv")
    df = pd.read_csv(csv_path)

    X = df[FEATURE_COLS].values
    y = df["rebalancing_label"].astype(int).values

    model.train(standardize(X), y)
    weights = model.getWeights()

    return {
        "status": 200,
        "message": f"Model trained on {len(y)} samples from dataset.csv (standardized features)",
        "n_samples": len(y),
        "n_features": len(FEATURE_COLS),
        "classes": list(map(int, model.model.classes_)),
        "coeff":      weights["coeff"],
        "intercept":  weights["intercept"],
    }

@app.get("/weights")
async def getWeights():
    weights = model.getWeights()
    return weights

@app.post("/weights")
async def setWeights(req: Request):
    body = await req.json()
    try:
        model.setWeights(body.get("coeff"), body.get("intercept"))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "status": 200,
        "message": "Model Weights Updated"
    }
