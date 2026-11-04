// The model call contract (PRD §7.2). Two fixed adapters implement it; there
// is no plugin system, and a failed call never falls back to another provider.

import type { ModelErrorKind } from "@pew/core";

export type AdapterName = "anthropic_messages" | "openai_compatible";

export interface ModelEndpoint {
  adapter: AdapterName;
  endpoint: string;
  model: string;
  apiKey: string;
  outputLimit: number;
  timeoutMs: number;
  /** Explicit opt-in for a model served over plain HTTP on this machine. */
  allowLocalHttp: boolean;
}

export interface ImageInput {
  mediaType: string;
  base64: string;
}

export interface ModelRequest {
  system: string;
  text: string;
  images?: ImageInput[];
  /** JSON Schema: every property required, additionalProperties false. */
  schema: Record<string, unknown>;
  schemaName: string;
  signal?: AbortSignal;
}

export interface ModelResponse {
  text: string;
  /** The model the provider reports having used. */
  model: string;
  /** Undefined when the provider did not report it. Unknown is never 0. */
  inputTokens?: number;
  outputTokens?: number;
}

export class ModelError extends Error {
  constructor(
    readonly kind: ModelErrorKind,
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

export type CallModel = (config: ModelEndpoint, request: ModelRequest) => Promise<ModelResponse>;
