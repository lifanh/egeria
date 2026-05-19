import { Context, type Effect } from "effect";
import type { LlmError } from "../shared/errors.ts";

/**
 * Provider-neutral message shape. Keeping this small avoids leaking
 * AI SDK / Vertex types across module boundaries.
 */
export interface LlmMessage {
  readonly role: "system" | "user" | "assistant";
  readonly content: string;
}

/**
 * A tool the LLM is allowed to call during a single `generate`. The
 * LLM module wraps these for the underlying provider; the caller (the
 * agent) supplies a Promise-returning execute function and provides
 * its own validation/safety inside the closure.
 */
export interface LlmTool {
  readonly name: string;
  readonly description: string;
  /** JSON Schema (draft 2020-12) describing the tool's input. */
  readonly inputJsonSchema: unknown;
  readonly execute: (input: unknown) => Promise<unknown>;
}

export interface LlmRequest {
  readonly messages: ReadonlyArray<LlmMessage>;
  readonly system?: string;
  readonly tools?: ReadonlyArray<LlmTool>;
  /** Hard upper bound on tool/model steps. Defaults to 1 (no tool loop). */
  readonly maxSteps?: number;
}

/**
 * Compact per-step record useful for logging plan / action / observation.
 */
export interface LlmStep {
  readonly stepNumber: number;
  readonly text: string;
  readonly toolCalls: ReadonlyArray<{
    readonly toolName: string;
    readonly input: unknown;
  }>;
  readonly toolResults: ReadonlyArray<{
    readonly toolName: string;
    readonly output: unknown;
  }>;
  readonly finishReason: string;
}

export interface LlmResponse {
  readonly text: string;
  readonly steps: ReadonlyArray<LlmStep>;
}

export interface LlmClient {
  readonly generate: (
    request: LlmRequest,
  ) => Effect.Effect<LlmResponse, LlmError>;
}

/**
 * Effect service tag for the LLM client.
 */
export class LlmClientTag extends Context.Tag("LlmClient")<
  LlmClientTag,
  LlmClient
>() {}
