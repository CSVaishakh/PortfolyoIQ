import * as tf from '@tensorflow/tfjs';

interface LogisticRegressionParams {
  C?: number;
  max_iter?: number;
  tol?: number;
  fit_intercept?: boolean;
  /** Learning rate for the Adam optimizer (no direct sklearn equivalent). */
  lr?: number;
}

export type EpochCallback = (epoch: number, logs?: tf.Logs) => void;

class LogisticRegression {
  // ── Hyperparameters (sklearn naming) ───────────────────────────────────
  public C: number;
  public max_iter: number;
  public tol: number;
  public fit_intercept: boolean;

  // ── Internal ───────────────────────────────────────────────────────────
  private lr: number;
  private model: tf.Sequential | null;

  // ── Post-fit attributes (sklearn naming, null until fit() is called) ──
  /** Weight matrix, shape (1, n_features). */
  public coef_: number[][] | null = null;
  /** Bias vector, shape (1,). */
  public intercept_: number[] | null = null;
  /** Sorted unique class labels seen during fit. */
  public classes_: number[] | null = null;
  /** Number of features seen during fit. */
  public n_features_in_: number | null = null;
  /** Actual number of epochs run, wrapped in an array like sklearn's (n_classes,). */
  public n_iter_: number[] | null = null;

  constructor({
    C             = 1.0,
    max_iter      = 100,
    tol           = 1e-4,
    fit_intercept = true,
    lr            = 0.1,
  }: LogisticRegressionParams = {}) {
    this.C             = C;
    this.max_iter      = max_iter;
    this.tol           = tol;
    this.fit_intercept = fit_intercept;
    this.lr            = lr;
    this.model         = null;
  }

  private build(nFeatures: number): void {
    if (this.model) this.model.dispose();

    this.model = tf.sequential();
    this.model.add(tf.layers.dense({
      units:              1,
      inputShape:         [nFeatures],
      activation:         'sigmoid',
      kernelRegularizer:  tf.regularizers.l2({ l2: 1 / this.C }),
      kernelInitializer:  'glorotUniform',
      biasInitializer:    'zeros',
      useBias:            this.fit_intercept,
    }));

    this.model.compile({
      optimizer: tf.train.adam(this.lr),
      loss:      'binaryCrossentropy',
      metrics:   ['accuracy'],
    });
  }

  /**
   * Train the model. Returns `this` so calls can be chained (mirrors sklearn's
   * `fit` returning self).
   *
   * When `onEpoch` is provided it is invoked after every epoch; returning `false`
   * from the callback stops training early. This lets callers implement early
   * stopping on a held-out split instead of always running `max_iter` epochs.
   */
  async fit(X: number[][], y: number[], onEpoch: EpochCallback | null = null): Promise<this> {
    const nFeatures = X[0].length;
    this.classes_       = [...new Set(y)].sort((a, b) => a - b);
    this.n_features_in_ = nFeatures;

    // Only (re)build if no model exists yet or the input dimension changed.
    // Preserves previously loaded global weights so fit() acts as a warm-start.
    if (!this.model || this.coef_?.[0]?.length !== nFeatures) {
      this.build(nFeatures);
    }

    const Xt = tf.tensor2d(X);
    const yt = tf.tensor2d(y, [y.length, 1]);

    const history = await this.model!.fit(Xt, yt, {
      epochs:    this.max_iter,
      batchSize: 32,
      shuffle:   true,
      callbacks: onEpoch ? { onEpochEnd: onEpoch } : undefined,
    });

    Xt.dispose();
    yt.dispose();

    // Populate sklearn-style post-fit attributes.
    const weights = this.model!.layers[0].getWeights();
    const W       = weights[0]; // shape (n_features, 1)
    const b       = weights[1] ?? null; // shape (1,) or absent when fit_intercept=false

    // sklearn coef_ shape: (1, n_features) — transpose from TF's (n_features, 1)
    this.coef_      = W.transpose().arraySync() as number[][];
    this.intercept_ = b ? (b.arraySync() as number[]) : [0];
    this.n_iter_    = [history.epoch.length];

    return this;
  }

  /**
   * Predict class labels.
   * Uses `classes_` so the output labels match whatever was seen during fit.
   */
  predict(X: number[][]): number[] {
    const proba = this.predict_proba(X);
    // Single-class training: classes_ has only one element; always return it.
    if (this.classes_!.length === 1) {
      return proba.map(() => this.classes_![0]);
    }
    return proba.map(row => this.classes_![row[1] >= 0.5 ? 1 : 0]);
  }

  /**
   * Probability estimates, shape (n_samples, 2).
   * Column 0 = P(y = classes_[0]), column 1 = P(y = classes_[1]).
   * Mirrors sklearn's `predict_proba` exactly.
   */
  predict_proba(X: number[][]): number[][] {
    return tf.tidy(() => {
      const p1 = (this.model!.predict(tf.tensor2d(X)) as tf.Tensor)
        .flatten()
        .arraySync() as number[];
      return p1.map(p => [1 - p, p]);
    });
  }

  /** camelCase alias kept for TypeScript/JS convention. */
  predictProba(X: number[][]): number[][] {
    return this.predict_proba(X);
  }

  /**
   * Log-odds scores before the sigmoid, shape (n_samples,).
   * Equivalent to sklearn's `decision_function`.
   */
  decision_function(X: number[][]): number[] {
    return tf.tidy(() => {
      const weights = this.model!.layers[0].getWeights();
      const W       = weights[0];
      const b       = weights[1] ?? null;
      const Xt      = tf.tensor2d(X);
      const linear  = b ? Xt.matMul(W).add(b) : Xt.matMul(W);
      return linear.flatten().arraySync() as number[];
    });
  }

  /**
   * Load weights into the model — the entry point for the federated learning
   * receive-global-weights step.
   *
   * `coef`      — shape (1, n_features), matching sklearn's coef_ convention.
   * `intercept` — shape (1,), matching sklearn's intercept_ convention.
   *
   * Builds the model first if it hasn't been built yet (e.g. before the first
   * local fit), so the client can warm-start from the global model without
   * needing local training data upfront.
   */
  setWeights(coef: number[][], intercept: number[]): void {
    const nFeatures = coef[0].length;

    if (!this.model) this.build(nFeatures);

    // coef is (1, n_features) — TF.js dense kernel expects (n_features, 1)
    const W = tf.tensor2d(coef).transpose();
    const b = tf.tensor1d(intercept);

    this.model!.layers[0].setWeights(
      this.fit_intercept ? [W, b] : [W]
    );

    W.dispose();
    b.dispose();

    // Keep the sklearn-style attributes in sync
    this.coef_          = coef;
    this.intercept_     = intercept;
    this.n_features_in_ = nFeatures;
  }

  /**
   * Returns the current coef_ and intercept_ — ready to POST to
   * /client/model/weights for the federated upload step.
   */
  getWeights(): { coef: number[][]; intercept: number[] } {
    return {
      coef:      this.coef_!,
      intercept: this.intercept_!,
    };
  }

  /** Mean accuracy on (X, y). Mirrors sklearn's `score`. */
  score(X: number[][], y: number[]): number {
    const preds = this.predict(X);
    return preds.filter((p, i) => p === y[i]).length / y.length;
  }
}

export default LogisticRegression;
