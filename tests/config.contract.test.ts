import { describe, expect, test } from "bun:test";
import { envSchema } from "../src/config/internal/validation.ts";

/**
 * Config contract tests run against the raw env schema. We don't
 * spin up the Effect Layer here because process.env is global; the
 * schema is the boundary that matters.
 */

const baseEnv = {
  MODEL_PROVIDER: "google-vertex",
  MODEL_NAME: "gemini-2.5-flash",
  API_KEY: "test-key",
};

describe("envSchema", () => {
  test("accepts a minimal env and applies defaults", () => {
    const parsed = envSchema.parse(baseEnv);
    expect(parsed.MODEL_PROVIDER).toBe("google-vertex");
    expect(parsed.NOTES_DIR).toBe("./notes");
    expect(parsed.MAX_AGENT_STEPS).toBe(5);
    expect(parsed.LLM_TIMEOUT_MS).toBe(30_000);
    expect(parsed.TOOL_TIMEOUT_MS).toBe(10_000);
  });

  test("rejects missing API_KEY", () => {
    const result = envSchema.safeParse({
      MODEL_PROVIDER: "google-vertex",
      MODEL_NAME: "gemini-2.5-flash",
    });
    expect(result.success).toBe(false);
  });

  test("coerces numeric strings", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      MAX_AGENT_STEPS: "12",
      LLM_TIMEOUT_MS: "15000",
    });
    expect(parsed.MAX_AGENT_STEPS).toBe(12);
    expect(parsed.LLM_TIMEOUT_MS).toBe(15_000);
  });

  test("rejects non-positive numeric values", () => {
    expect(
      envSchema.safeParse({ ...baseEnv, MAX_AGENT_STEPS: "0" }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...baseEnv, LLM_TIMEOUT_MS: "-5" }).success,
    ).toBe(false);
  });

  test("rejects unknown MODEL_PROVIDER values", () => {
    expect(
      envSchema.safeParse({ ...baseEnv, MODEL_PROVIDER: "openai" }).success,
    ).toBe(false);
  });
});
