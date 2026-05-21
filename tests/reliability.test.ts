import { describe, expect, test } from "bun:test";
import { Effect, Ref } from "effect";
import { withLlmRetry } from "../src/llm/internal/retryPolicy.ts";
import { withLlmTimeout } from "../src/llm/internal/timeoutPolicy.ts";
import { LlmError } from "../src/shared/errors.ts";
import { toUserMessage } from "../src/shared/userMessages.ts";

describe("LLM retry policy", () => {
  test("retries retryable failures up to the cap, then surfaces last error", async () => {
    const attempts = await Effect.runPromise(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const eff = Effect.gen(function* () {
          yield* Ref.update(count, (n) => n + 1);
          return yield* Effect.fail(
            new LlmError({ message: "boom", retryable: true }),
          );
        });
        const exit = yield* Effect.exit(withLlmRetry(eff));
        const calls = yield* Ref.get(count);
        return { exit, calls };
      }),
    );
    expect(attempts.exit._tag).toBe("Failure");
    // Base attempt + 2 retries = 3 calls.
    expect(attempts.calls).toBe(3);
  });

  test("does not retry non-retryable failures (fast-fail)", async () => {
    const { calls } = await Effect.runPromise(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const eff = Effect.gen(function* () {
          yield* Ref.update(count, (n) => n + 1);
          return yield* Effect.fail(
            new LlmError({
              message: "401 unauthorized",
              retryable: false,
              statusCode: 401,
            }),
          );
        });
        yield* Effect.exit(withLlmRetry(eff));
        return { calls: yield* Ref.get(count) };
      }),
    );
    expect(calls).toBe(1);
  });

  test("stops retrying once a call succeeds", async () => {
    const { value, calls } = await Effect.runPromise(
      Effect.gen(function* () {
        const count = yield* Ref.make(0);
        const eff = Effect.gen(function* () {
          const n = yield* Ref.updateAndGet(count, (n) => n + 1);
          if (n < 2) {
            return yield* Effect.fail(
              new LlmError({ message: "flaky", retryable: true }),
            );
          }
          return "ok";
        });
        const value = yield* withLlmRetry(eff);
        return { value, calls: yield* Ref.get(count) };
      }),
    );
    expect(value).toBe("ok");
    expect(calls).toBe(2);
  });
});

describe("LLM timeout policy", () => {
  test("converts overruns to a non-retryable LlmError", async () => {
    const exit = await Effect.runPromiseExit(
      withLlmTimeout(20)(Effect.sleep("200 millis").pipe(Effect.as("never"))),
    );
    expect(exit._tag).toBe("Failure");
    if (exit._tag === "Failure") {
      const err = JSON.stringify(exit.cause);
      expect(err).toContain("timeout");
      expect(err).toContain("\"retryable\":false");
    }
  });
});

describe("toUserMessage", () => {
  test("LlmError 401 maps to auth message", () => {
    expect(
      toUserMessage(
        new LlmError({ message: "unauth", retryable: false, statusCode: 401 }),
      ),
    ).toContain("authenticate");
  });

  test("LlmError 429 maps to rate-limit message", () => {
    expect(
      toUserMessage(
        new LlmError({ message: "rate", retryable: true, statusCode: 429 }),
      ),
    ).toContain("rate-limited");
  });

  test("Generic retryable LlmError suggests trying again", () => {
    expect(
      toUserMessage(new LlmError({ message: "network", retryable: true })),
    ).toContain("try again");
  });

  test("ConfigError mentions .env", () => {
    expect(toUserMessage({ _tag: "ConfigError", message: "missing" })).toContain(
      ".env",
    );
  });

  test("ToolError names the failing tool", () => {
    expect(
      toUserMessage({
        _tag: "ToolError",
        tool: "writeNote",
        message: "boom",
      }),
    ).toContain("writeNote");
  });

  test("Unknown errors get a safe fallback", () => {
    expect(toUserMessage(null)).toBe(
      "Something unexpected happened. Please try again.",
    );
    expect(toUserMessage({ random: true })).toBe(
      "Something unexpected happened. Please try again.",
    );
  });
});
