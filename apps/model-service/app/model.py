from sklearn.linear_model import LogisticRegression
import numpy as np

N_FEATURES = 12


class GlobalModel:
    def __init__(self):
        self.model = LogisticRegression(max_iter=1000)

    def train(self, X, y):
        self.model.fit(X, y)

    def getWeights(self):
        return {
            "coeff": self.model.coef_.tolist(),
            "intercept": self.model.intercept_.tolist(),
        }

    def setWeights(self, coeff, intercept):
        """Set weights, rejecting malformed or non-finite payloads."""
        coef_arr = np.array(coeff, dtype=float)
        int_arr = np.array(intercept, dtype=float)

        if coef_arr.ndim != 2 or coef_arr.shape[0] != 1:
            raise ValueError(f"coeff must be a 1xN matrix, got {coef_arr.shape}")
        if coef_arr.shape[1] != N_FEATURES:
            raise ValueError(f"coeff must have {N_FEATURES} features, got {coef_arr.shape[1]}")
        if int_arr.ndim != 1 or int_arr.shape[0] < 1:
            raise ValueError("intercept must be a non-empty vector")

        if not np.isfinite(coef_arr).all() or not np.isfinite(int_arr).all():
            raise ValueError("weights contain non-finite values")

        self.model.coef_ = coef_arr
        self.model.intercept_ = int_arr
