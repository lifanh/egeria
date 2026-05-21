import { Data } from "effect";

/**
 * Base shape for all domain errors. Each module declares its own tagged
 * subclasses; this file collects ones used across module boundaries.
 */

export class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class LlmError extends Data.TaggedError("LlmError")<{
  readonly message: string;
  /** True for transient failures safe to retry (network, 429, 5xx). */
  readonly retryable: boolean;
  /** Optional HTTP status code if the failure came from an API call. */
  readonly statusCode?: number;
  readonly cause?: unknown;
}> {}

export class ToolError extends Data.TaggedError("ToolError")<{
  readonly tool: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class MemoryError extends Data.TaggedError("MemoryError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export class AgentError extends Data.TaggedError("AgentError")<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type AppError =
  | ConfigError
  | LlmError
  | ToolError
  | MemoryError
  | AgentError;
