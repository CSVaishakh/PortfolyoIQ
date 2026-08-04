"""Smoke-test the local model-service training and weights endpoints."""

import csv
import json
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

BASE_URL = "http://localhost:8000"
DATASET_PATH = Path(__file__).with_name("dataset.csv")
REQUEST_TIMEOUT_SECONDS = 10


def load_dataset() -> tuple[list[list[float]], list[int]]:
    with DATASET_PATH.open(newline="", encoding="utf-8") as dataset_file:
        rows = csv.DictReader(dataset_file)
        feature_names = [name for name in rows.fieldnames or [] if name != "rebalancing_label"]
        if not feature_names:
            raise ValueError("dataset.csv has no feature columns")

        features: list[list[float]] = []
        labels: list[int] = []
        for row in rows:
            features.append([float(row[name]) for name in feature_names])
            labels.append(int(row["rebalancing_label"]))

    if not features:
        raise ValueError("dataset.csv contains no observations")
    return features, labels


def request_json(url: str, payload: dict[str, object] | None = None) -> dict[str, object]:
    body = json.dumps(payload).encode("utf-8") if payload is not None else None
    request = Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"} if body else {},
        method="POST" if body else "GET",
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        decoded = json.loads(response.read().decode("utf-8"))
    if not isinstance(decoded, dict):
        raise TypeError("Expected a JSON object from the model service")
    return decoded


def main() -> None:
    features, labels = load_dataset()
    print("=" * 50)
    print("Testing Model Training API")
    print("=" * 50)

    print("\n1. Training the model...")
    try:
        train_result = request_json(f"{BASE_URL}/train", {"X": features, "y": labels})
        print(f"Response: {train_result}")
    except (HTTPError, URLError, TimeoutError, TypeError, ValueError) as error:
        print(f"Error during training: {error}")
        return

    print("\n2. Getting weights...")
    try:
        weights = request_json(f"{BASE_URL}/weights")
        raw_coefficients = weights.get("coeff", [])
        coefficients = raw_coefficients if isinstance(raw_coefficients, list) else []
        print(f"Coefficients: {coefficients}")
        print(f"Intercept: {weights.get('intercept', [])}")
        print(f"Sample coefficients (first 5): {coefficients[:5]}")
    except (HTTPError, URLError, TimeoutError, TypeError, ValueError) as error:
        print(f"Error getting weights: {error}")
        return

    print("\n" + "=" * 50)
    print("Test completed!")
    print("=" * 50)


if __name__ == "__main__":
    main()
