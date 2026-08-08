from fastapi import FastAPI, Request, HTTPException
from .model import GlobalModel, N_FEATURES
import pandas as pd
import numpy as np
import os
import hmac
import json
from pathlib import Path
from sklearn.metrics import accuracy_score, brier_score_loss, precision_score, recall_score, roc_auc_score

app = FastAPI()
model = GlobalModel()
MODEL_SERVICE_SECRET = os.environ.get("MODEL_SERVICE_SECRET")
DEMO_MODEL_ENABLED = os.environ.get("DEMO_MODEL_ENABLED", "false").lower() == "true"


def require_platform_service(req: Request) -> None:
    """Only the platform service may read or mutate model weights."""
    if not MODEL_SERVICE_SECRET:
        raise HTTPException(status_code=503, detail="MODEL_SERVICE_SECRET is not configured")
    provided = req.headers.get("x-model-service-secret", "")
    if not hmac.compare_digest(provided, MODEL_SERVICE_SECRET):
        raise HTTPException(status_code=403, detail="model service authorization failed")


def require_demo_model_enabled() -> None:
    """Keep demonstration-only training opt-in and out of production by default."""
    if not DEMO_MODEL_ENABLED:
        raise HTTPException(
            status_code=410,
            detail="Demonstration model training is disabled. Set DEMO_MODEL_ENABLED=true only for the paper/demo environment.",
        )


def calibration_error(labels: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> float:
    """Expected calibration error for the paper's synthetic-demo report."""
    total = len(labels)
    error = 0.0
    for index in range(bins):
        lower, upper = index / bins, (index + 1) / bins
        mask = (probabilities >= lower) & (probabilities < upper if index < bins - 1 else probabilities <= upper)
        if np.any(mask):
            error += np.sum(mask) / total * abs(np.mean(probabilities[mask]) - np.mean(labels[mask]))
    return float(error)

FEATURE_SPEC_PATH = Path(__file__).resolve().parents[3] / "packages" / "model-contract" / "feature-spec.json"
with FEATURE_SPEC_PATH.open(encoding="utf-8") as feature_spec_file:
    FEATURE_SPEC = json.load(feature_spec_file)
FEATURE_COLS = FEATURE_SPEC["featureNames"]

# ── Shared feature scaler ────────────────────────────────────────────────────
# FIXED transform derived from dataset.csv and loaded from the same versioned
# JSON artifact as apps/react-client/lib/featureEngineering.ts.
# Every side — the browser (TF.js) and this service (sklearn) — standardizes
# with these exact constants, so weights live in one comparable space and
# FedAvg never mixes scaled with unscaled models. Raw magnitudes no longer
# dictate gradient size, which is what previously collapsed the model onto
# `days_since_last_rebalance` and `total_weight_drift`.
SCALER_MEAN = np.array(FEATURE_SPEC["scalerMean"], dtype=float)
SCALER_STD = np.array(FEATURE_SPEC["scalerStd"], dtype=float)


def standardize(X: np.ndarray) -> np.ndarray:
    """Standardize with the shared constants; zero-std columns map to 0."""
    X = np.asarray(X, dtype=float)
    return np.where(SCALER_STD < 1e-9, 0.0, (X - SCALER_MEAN) / SCALER_STD)


def validate_training_payload(body: object) -> tuple[np.ndarray, np.ndarray]:
    """Validate raw training observations before placing them in model space."""
    if not isinstance(body, dict):
        raise ValueError("request body must be a JSON object")

    try:
        X = np.asarray(body["X"], dtype=float)
        y_values = np.asarray(body["y"], dtype=float)
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("X and y must be numeric") from exc

    if X.ndim != 2 or X.shape[0] < 2 or X.shape[1] != N_FEATURES:
        raise ValueError(f"X must have shape (n, {N_FEATURES}) with n >= 2")
    if y_values.ndim != 1 or y_values.shape[0] != X.shape[0]:
        raise ValueError("y must be a one-dimensional vector with one label per X row")
    if not np.isfinite(X).all():
        raise ValueError("X contains non-finite values")
    if not np.isfinite(y_values).all() or not np.isin(y_values, [0, 1]).all():
        raise ValueError("y must contain only binary labels 0 and 1")

    y = y_values.astype(int)
    if np.unique(y).size != 2:
        raise ValueError("y must contain both binary classes 0 and 1")

    return X, y

@app.get("/")
async def healt(req: Request):
   return "Status Ok!"
   
@app.post("/train")
async def train(req: Request):
    """Train from raw observations, always applying the canonical scaler first."""
    require_platform_service(req)
    require_demo_model_enabled()
    try:
        X, y = validate_training_payload(await req.json())
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    model.train(standardize(X), y)

    return {
        "status": 200,
        "message": "Model Training Completed (standardized features)",
    }


@app.post("/train/dataset")
async def train_from_dataset(req: Request):
    require_platform_service(req)
    require_demo_model_enabled()
    csv_path = os.path.join(os.path.dirname(__file__), "..", "demo-dataset.csv")
    df = pd.read_csv(csv_path)

    X = df[FEATURE_COLS].values.astype(float)
    y = df["rebalancing_label"].astype(int).values
    if not np.isfinite(X).all() or not np.isin(y, [0, 1]).all() or np.unique(y).size != 2:
        raise HTTPException(status_code=422, detail="Demo dataset must contain finite features and both binary classes")

    # Preserve source row order for a reproducible 60/20/20 chronological-style
    # demonstration split. The synthetic source has no real dates, so the report
    # explicitly describes this as row-order rather than market-time validation.
    train_end, validation_end = int(len(y) * 0.6), int(len(y) * 0.8)
    X_train, y_train = X[:train_end], y[:train_end]
    X_validation, y_validation = X[train_end:validation_end], y[train_end:validation_end]
    X_test, y_test = X[validation_end:], y[validation_end:]

    model.train(standardize(X_train), y_train)
    weights = model.getWeights()
    validation_probability = model.model.predict_proba(standardize(X_validation))[:, 1]
    test_probability = model.model.predict_proba(standardize(X_test))[:, 1]
    test_prediction = (test_probability >= 0.5).astype(int)
    report = {
        "split": "source-row-order 60/20/20; synthetic dataset has no timestamps",
        "train_samples": int(len(y_train)),
        "validation_samples": int(len(y_validation)),
        "test_samples": int(len(y_test)),
        "validation_auc": float(roc_auc_score(y_validation, validation_probability)),
        "test_auc": float(roc_auc_score(y_test, test_probability)),
        "test_accuracy": float(accuracy_score(y_test, test_prediction)),
        "test_precision": float(precision_score(y_test, test_prediction, zero_division=0)),
        "test_recall": float(recall_score(y_test, test_prediction, zero_division=0)),
        "test_brier_score": float(brier_score_loss(y_test, test_probability)),
        "test_expected_calibration_error": calibration_error(y_test, test_probability),
        "baseline_accuracy": float(max(np.mean(y_test), 1 - np.mean(y_test))),
    }

    return {
        "status": 200,
        "message": f"Demonstration model trained on {len(y)} samples from demo-dataset.csv (standardized features)",
        "n_samples": len(y),
        "n_features": len(FEATURE_COLS),
        "classes": list(map(int, model.model.classes_)),
        "coeff":      weights["coeff"],
        "intercept":  weights["intercept"],
        "evaluation": report,
    }

@app.get("/weights")
async def getWeights(req: Request):
    require_platform_service(req)
    try:
        weights = model.getWeights()
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return weights

@app.post("/weights")
async def setWeights(req: Request):
    require_platform_service(req)
    body = await req.json()
    try:
        model.setWeights(body.get("coeff"), body.get("intercept"))
    except (ValueError, KeyError, TypeError) as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return {
        "status": 200,
        "message": "Model Weights Updated"
    }
