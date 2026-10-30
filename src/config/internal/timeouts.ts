import { Effect } from "effect";
import { z } from "zod";
import { ConfigError } from "../../shared/errors.ts";

export const timeoutSchema = z.object({
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export interface Timeouts {
  readonly llmTimeoutMs: number;
  readonly toolTimeoutMs: number;
}

/** Shared by the CLI config and the VM service; no model credentials required. */
export function parseTimeouts(input: unknown) {
  return Effect.try({
    try: (): Timeouts => {
      const value = timeoutSchema.parse(input);
      return {
        llmTimeoutMs: value.LLM_TIMEOUT_MS,
        toolTimeoutMs: value.TOOL_TIMEOUT_MS,
      };
    },
    catch: () =>
      new ConfigError({
        message: "LLM_TIMEOUT_MS and TOOL_TIMEOUT_MS must be positive integers",
      }),
  });
}
