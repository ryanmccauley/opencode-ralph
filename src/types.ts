// ─── Shared Types ─────────────────────────────────────────────────────────────

export interface Config {
  defaultModel: string;
  /** Default thinking variant name, or "off" */
  defaultThinking: string;
  defaultMaxIter: number;
}

export interface SessionMeta {
  timestamp: string;
  model: string;
  /** Thinking variant name used, or "off" */
  thinking: string;
  maxIter: number;
  prompt: string;
  status: "complete" | "incomplete";
  iterations: number;
}

/** Flattened model info from the SDK */
export interface ModelInfo {
  /** Full ID: providerID/modelID */
  id: string;
  /** Display name from the SDK */
  name: string;
  /** The provider ID */
  providerID: string;
  /** The model ID within the provider */
  modelID: string;
  /** Whether the model supports reasoning/thinking */
  reasoning: boolean;
  /**
   * Available thinking variants for this model.
   * Keys are variant names (e.g. "low", "high", "max").
   * Values are provider-specific config objects to pass into agent YAML.
   * Empty object if no variants available.
   */
  variants: Record<string, Record<string, unknown>>;
}

export const DEFAULT_CONFIG: Config = {
  defaultModel: "",
  defaultThinking: "off",
  defaultMaxIter: 50,
};

export const DONE_TOKEN = "<ralph>DONE</ralph>";
