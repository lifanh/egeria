import { Duration, Effect, Schedule } from "effect";
import type { LlmError } from "../../shared/errors.ts";

/**
 * Retry policy for LLM calls: small exponential backoff, capped attempts.
 * LLM calls are treated as idempotent for our purposes (deterministic
 * temperature is fine; we still cap retries to avoid runaway cost).
 */
export const llmRetrySchedule = Schedule.exponential(Duration.millis(250)).pipe(
  Schedule.compose(Schedule.recurs(2)),
);

export const withLlmRetry = <A, R>(
  effect: Effect.Effect<A, LlmError, R>,
): Effect.Effect<A, LlmError, R> => effect.pipe(Effect.retry(llmRetrySchedule));
