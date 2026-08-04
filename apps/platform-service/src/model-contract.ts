/**
 * Versioned contract for every coefficient vector stored or aggregated by the
 * platform. A weight has no meaning without these versions: the same slot can
 * represent a different feature or scaling transform after a client update.
 */
export const MODEL_CONTRACT = {
  featureVersion: 1,
  scalerVersion: 1,
  modelVersion: 1,
} as const;

export interface ModelContractPayload {
  feature_version: number;
  scaler_version: number;
  model_version: number;
}

export function hasCurrentModelContract(payload: ModelContractPayload): boolean {
  return payload.feature_version === MODEL_CONTRACT.featureVersion
    && payload.scaler_version === MODEL_CONTRACT.scalerVersion
    && payload.model_version === MODEL_CONTRACT.modelVersion;
}
