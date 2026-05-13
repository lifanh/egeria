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

export interface LlmRequest {
  readonly messages: ReadonlyArray<LlmMessage>;
  readonly system?: string;
}

export interface LlmResponse {
  readonly text: string;
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
