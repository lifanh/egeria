import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { ConfigLive, ConfigTag } from "../src/config/index.ts";
import { envSchema } from "../src/config/internal/validation.ts";

/**
 * Most config contract tests run against the raw env schema. The few
 * ConfigLive tests snapshot and restore env keys because Bun.env is global.
 */

const baseEnv = {
  MODEL_PROVIDER: "google-vertex",
  MODEL_NAME: "gemini-2.5-flash",
  API_KEY: "test-key",
};

const envKeys = [
  "MODEL_PROVIDER",
  "MODEL_NAME",
  "API_KEY",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_SAMPLE_RATE",
] as const;

const originalEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of envKeys) {
    originalEnv.set(key, Bun.env[key]);
    delete Bun.env[key];
  }
  Bun.env.MODEL_PROVIDER = baseEnv.MODEL_PROVIDER;
  Bun.env.MODEL_NAME = baseEnv.MODEL_NAME;
  Bun.env.API_KEY = baseEnv.API_KEY;
});

afterEach(() => {
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete Bun.env[key];
    } else {
      Bun.env[key] = value;
    }
  }
});

describe("envSchema", () => {
  test("accepts a minimal env and applies defaults", () => {
    const parsed = envSchema.parse(baseEnv);
    expect(parsed.MODEL_PROVIDER).toBe("google-vertex");
    expect(parsed.NOTES_DIR).toBe("./notes");
    expect(parsed.MAX_AGENT_STEPS).toBe(5);
    expect(parsed.LLM_TIMEOUT_MS).toBe(30_000);
    expect(parsed.TOOL_TIMEOUT_MS).toBe(10_000);
    expect(parsed.LANGFUSE_SAMPLE_RATE).toBe(1);
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

  test("accepts complete optional Langfuse settings", () => {
    const parsed = envSchema.parse({
      ...baseEnv,
      LANGFUSE_PUBLIC_KEY: "pk-lf-test",
      LANGFUSE_SECRET_KEY: "sk-lf-test",
      LANGFUSE_BASE_URL: "https://us.cloud.langfuse.com",
      LANGFUSE_SAMPLE_RATE: "0.25",
    });
    expect(parsed.LANGFUSE_PUBLIC_KEY).toBe("pk-lf-test");
    expect(parsed.LANGFUSE_SECRET_KEY).toBe("sk-lf-test");
    expect(parsed.LANGFUSE_BASE_URL).toBe("https://us.cloud.langfuse.com");
    expect(parsed.LANGFUSE_SAMPLE_RATE).toBe(0.25);
  });

  test("maps Langfuse settings into an explicit enabled config variant", async () => {
    Bun.env.LANGFUSE_PUBLIC_KEY = "pk-lf-test";
    Bun.env.LANGFUSE_SECRET_KEY = "sk-lf-test";
    Bun.env.LANGFUSE_BASE_URL = "https://us.cloud.langfuse.com";
    Bun.env.LANGFUSE_SAMPLE_RATE = "0.25";

    const config = await Effect.runPromise(
      Effect.provide(ConfigTag, ConfigLive),
    );

    expect(config.langfuse).toEqual({
      enabled: true,
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      baseUrl: "https://us.cloud.langfuse.com",
      sampleRate: 0.25,
    });
  });

  test("maps missing Langfuse credentials into an explicit disabled config variant", async () => {
    const config = await Effect.runPromise(
      Effect.provide(ConfigTag, ConfigLive),
    );

    expect(config.langfuse).toEqual({ enabled: false });
  });

  test("rejects partial Langfuse credentials", () => {
    expect(
      envSchema.safeParse({ ...baseEnv, LANGFUSE_PUBLIC_KEY: "pk-lf-test" })
        .success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...baseEnv, LANGFUSE_SECRET_KEY: "sk-lf-test" })
        .success,
    ).toBe(false);
  });

  test("rejects Langfuse sample rates outside 0..1", () => {
    expect(
      envSchema.safeParse({ ...baseEnv, LANGFUSE_SAMPLE_RATE: "-0.1" }).success,
    ).toBe(false);
    expect(
      envSchema.safeParse({ ...baseEnv, LANGFUSE_SAMPLE_RATE: "1.1" }).success,
    ).toBe(false);
  });
});
