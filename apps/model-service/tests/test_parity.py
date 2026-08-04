"""Cross-runtime contract parity, Python half.

The TypeScript client asserts the same fixture in
apps/react-client/lib/modelParity.test.ts. If the two runtimes ever disagree on
standardization or on turning a coefficient vector into a probability, federated
averaging is mixing incomparable models and these tests fail first.
"""

import json
import unittest
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression

from app.main import FEATURE_COLS, FEATURE_SPEC, SCALER_MEAN, SCALER_STD, standardize
from app.model import GlobalModel, N_FEATURES

CONTRACT_DIR = Path(__file__).resolve().parents[3] / "packages" / "model-contract"
with (CONTRACT_DIR / "parity-fixtures.json").open(encoding="utf-8") as handle:
    FIXTURES = json.load(handle)

# Float64 arithmetic on both sides; the browser's float32 kernels are the looser
# half of this contract and carry their own tolerance in the TypeScript test.
EXACT_TOLERANCE = 1e-12


class FeatureSpecTest(unittest.TestCase):
    def test_service_reads_the_shared_spec_rather_than_a_local_copy(self) -> None:
        self.assertEqual(FEATURE_COLS, FEATURE_SPEC["featureNames"])
        np.testing.assert_array_equal(SCALER_MEAN, np.array(FEATURE_SPEC["scalerMean"]))
        np.testing.assert_array_equal(SCALER_STD, np.array(FEATURE_SPEC["scalerStd"]))
        self.assertEqual(len(FEATURE_COLS), N_FEATURES)
        self.assertEqual(len(FEATURE_COLS), FIXTURES["nFeatures"])

    def test_fixture_targets_the_active_model_contract(self) -> None:
        self.assertEqual(FIXTURES["featureVersion"], FEATURE_SPEC["featureVersion"])
        self.assertEqual(FIXTURES["scalerVersion"], FEATURE_SPEC["scalerVersion"])
        self.assertEqual(FIXTURES["modelVersion"], FEATURE_SPEC["modelVersion"])


class ScalerParityTest(unittest.TestCase):
    def test_fixture_vectors_standardize_to_the_shared_expected_values(self) -> None:
        actual = standardize(np.array(FIXTURES["rawVectors"], dtype=float))
        expected = np.array(FIXTURES["standardizedVectors"], dtype=float)
        np.testing.assert_allclose(actual, expected, atol=EXACT_TOLERANCE, rtol=0)

    def test_mean_maps_to_zero_and_one_sigma_maps_to_one(self) -> None:
        np.testing.assert_allclose(standardize(np.array([SCALER_MEAN])), np.zeros((1, N_FEATURES)), atol=EXACT_TOLERANCE)
        np.testing.assert_allclose(
            standardize(np.array([SCALER_MEAN + SCALER_STD])), np.ones((1, N_FEATURES)), atol=EXACT_TOLERANCE
        )

    def test_standardization_is_row_independent(self) -> None:
        rows = np.array(FIXTURES["rawVectors"], dtype=float)
        batch = standardize(rows)
        for index, row in enumerate(rows):
            np.testing.assert_allclose(standardize(np.array([row]))[0], batch[index], atol=EXACT_TOLERANCE)


class PredictionParityTest(unittest.TestCase):
    def _model_with_canonical_weights(self) -> LogisticRegression:
        model = LogisticRegression(max_iter=1000)
        model.coef_ = np.array(FIXTURES["canonicalCoeff"], dtype=float)
        model.intercept_ = np.array(FIXTURES["canonicalIntercept"], dtype=float)
        model.classes_ = np.array([0, 1])
        return model

    def test_canonical_weights_reproduce_the_shared_logits(self) -> None:
        model = self._model_with_canonical_weights()
        standardized = np.array(FIXTURES["standardizedVectors"], dtype=float)
        np.testing.assert_allclose(
            model.decision_function(standardized),
            np.array(FIXTURES["expectedLogits"], dtype=float),
            atol=EXACT_TOLERANCE,
            rtol=0,
        )

    def test_canonical_weights_reproduce_the_shared_probabilities(self) -> None:
        model = self._model_with_canonical_weights()
        probabilities = model.predict_proba(standardize(np.array(FIXTURES["rawVectors"], dtype=float)))
        np.testing.assert_allclose(
            probabilities[:, 1],
            np.array(FIXTURES["expectedProbabilities"], dtype=float),
            atol=EXACT_TOLERANCE,
            rtol=0,
        )
        np.testing.assert_allclose(probabilities.sum(axis=1), np.ones(len(probabilities)), atol=EXACT_TOLERANCE)

    def test_weights_survive_a_set_get_round_trip(self) -> None:
        model = GlobalModel()
        model.setWeights(FIXTURES["canonicalCoeff"], FIXTURES["canonicalIntercept"])
        weights = model.getWeights()
        np.testing.assert_allclose(weights["coeff"], FIXTURES["canonicalCoeff"], atol=EXACT_TOLERANCE)
        np.testing.assert_allclose(weights["intercept"], FIXTURES["canonicalIntercept"], atol=EXACT_TOLERANCE)

    def test_aggregated_weights_are_usable_for_inference_end_to_end(self) -> None:
        """The FedAvg output shape the platform pushes must be directly loadable."""
        model = GlobalModel()
        model.setWeights(FIXTURES["canonicalCoeff"], FIXTURES["canonicalIntercept"])
        model.model.classes_ = np.array([0, 1])
        probabilities = model.model.predict_proba(standardize(np.array(FIXTURES["rawVectors"], dtype=float)))
        np.testing.assert_allclose(
            probabilities[:, 1],
            np.array(FIXTURES["expectedProbabilities"], dtype=float),
            atol=EXACT_TOLERANCE,
            rtol=0,
        )


if __name__ == "__main__":
    unittest.main()
