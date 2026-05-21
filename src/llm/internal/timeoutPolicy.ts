import { Duration, Effect } from "effect";
import { LlmError } from "../../shared/errors.ts";

/**
 * Wrap an LLM effect with a timeout that surfaces as a typed LlmError.
 */
export const withLlmTimeout =
  (millis: number) =>
  <A, R>(effect: Effect.Effect<A, LlmError, R>): Effect.Effect<A, LlmError, R> =>
    effect.pipe(
      Effect.timeoutFail({
        duration: Duration.millis(millis),
        onTimeout: () =>
          new LlmError({
            message: `llm call exceeded ${millis}ms timeout`,
            // Timeouts already wrap the retry chain; do not retry again.
            retryable: false,
          }),
      }),
    );
