import { Duration, Effect, Schedule } from "effect";
import type { LlmError } from "../../shared/errors.ts";

/**
 * Exponential backoff capped at a small number of attempts.
 * Only applied to errors flagged `retryable: true` so 4xx auth/input
 * failures fail fast.
 */
const baseSchedule = Schedule.exponential(Duration.millis(250)).pipe(
  Schedule.compose(Schedule.recurs(2)),
);

const retryableSchedule = Schedule.intersect(
  baseSchedule,
  Schedule.recurWhile<LlmError>((err) => err.retryable),
);

export const withLlmRetry = <A, R>(
  effect: Effect.Effect<A, LlmError, R>,
): Effect.Effect<A, LlmError, R> => effect.pipe(Effect.retry(retryableSchedule));
