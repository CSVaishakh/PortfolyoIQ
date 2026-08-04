import unittest

import numpy as np

from app.main import SCALER_MEAN, SCALER_STD, standardize, validate_training_payload
from app.model import GlobalModel, N_FEATURES


class ModelContractTest(unittest.TestCase):
    def test_standardize_uses_the_declared_feature_contract(self) -> None:
        row = SCALER_MEAN + SCALER_STD
        standardized = standardize(np.array([row]))
        np.testing.assert_allclose(standardized, np.ones((1, N_FEATURES)))

    def test_training_payload_requires_two_binary_classes_and_feature_width(self) -> None:
        payload = {
            "X": [[0.0] * N_FEATURES, [1.0] * N_FEATURES],
            "y": [0, 1],
        }
        X, y = validate_training_payload(payload)
        self.assertEqual(X.shape, (2, N_FEATURES))
        self.assertEqual(y.tolist(), [0, 1])

        with self.assertRaisesRegex(ValueError, "shape"):
            validate_training_payload({"X": [[0.0] * (N_FEATURES - 1)] * 2, "y": [0, 1]})
        with self.assertRaisesRegex(ValueError, "both binary classes"):
            validate_training_payload({"X": [[0.0] * N_FEATURES] * 2, "y": [0, 0]})
        with self.assertRaisesRegex(ValueError, "only binary labels"):
            validate_training_payload({"X": [[0.0] * N_FEATURES] * 2, "y": [0, 0.5]})

    def test_weight_contract_requires_exactly_one_intercept(self) -> None:
        model = GlobalModel()
        with self.assertRaisesRegex(ValueError, "exactly one"):
            model.setWeights([[0.0] * N_FEATURES], [0.0, 1.0])


if __name__ == "__main__":
    unittest.main()
