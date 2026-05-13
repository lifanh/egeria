import { Context, type Effect } from "effect";
import type { z } from "zod";
import type { ToolError } from "../shared/errors.ts";

/**
 * Public description of a tool, suitable for prompting and listing.
 * Implementations live behind the `ToolService` and are not exposed.
 */
export interface ToolInfo {
  readonly name: string;
  readonly description: string;
  /** JSON schema describing the input, derived from the tool's Zod schema. */
  readonly inputJsonSchema: unknown;
}

/**
 * Internal tool definition. Authors register one of these per tool.
 * Kept in this file so other modules implementing a tool can import the
 * type without reaching into `internal/`.
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodType<TInput>;
  readonly execute: (input: TInput) => Effect.Effect<TOutput, ToolError>;
}

/**
 * Public tool service. Callers dispatch by name; the service handles
 * input validation, safety, and per-call timeout policy.
 */
export interface ToolService {
  readonly list: () => ReadonlyArray<ToolInfo>;
  readonly execute: (
    name: string,
    input: unknown,
  ) => Effect.Effect<unknown, ToolError>;
}

export class ToolServiceTag extends Context.Tag("ToolService")<
  ToolServiceTag,
  ToolService
>() {}
