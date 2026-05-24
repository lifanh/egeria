import { describe, expect, test } from "bun:test";
import type { Config } from "../src/config/index.ts";
import { startLangfuseTracing } from "../src/tracing/index.ts";

const baseConfig = {
  modelProvider: "google-vertex",
  modelName: "gemini-2.5-flash",
  apiKey: "test-key",
  notesDir: "./notes",
  maxAgentSteps: 5,
  llmTimeoutMs: 30_000,
  toolTimeoutMs: 10_000,
} satisfies Omit<Config, "langfuse">;

describe("startLangfuseTracing", () => {
  test("passes explicit Langfuse config to the tracing provider", async () => {
    const config: Config = {
      ...baseConfig,
      langfuse: {
        enabled: true,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        baseUrl: "https://us.cloud.langfuse.com",
        sampleRate: 0.25,
      },
    };
    let registered = false;
    let shutdown = false;
    let processorParams:
      | {
          publicKey?: string;
          secretKey?: string;
          baseUrl?: string;
        }
      | undefined;

    const handle = startLangfuseTracing(config, {
      createSpanProcessor: (params) => {
        processorParams = params;
        return {
          forceFlush: async () => {},
          onStart: () => {},
          onEnd: () => {},
          shutdown: async () => {},
        };
      },
      createProvider: () => ({
        register: () => {
          registered = true;
        },
        shutdown: async () => {
          shutdown = true;
        },
      }),
    });

    expect(handle.enabled).toBe(true);
    expect(registered).toBe(true);
    expect(processorParams).toMatchObject({
      publicKey: "pk-lf-test",
      secretKey: "sk-lf-test",
      baseUrl: "https://us.cloud.langfuse.com",
    });

    await handle.shutdown();
    expect(shutdown).toBe(true);
  });

  test("disables tracing when optional tracing startup fails", async () => {
    const config: Config = {
      ...baseConfig,
      langfuse: {
        enabled: true,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        sampleRate: 1,
      },
    };

    const handle = startLangfuseTracing(config, {
      createSpanProcessor: () => {
        throw new Error("otel startup failed");
      },
    });

    expect(handle.enabled).toBe(false);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });

  test("does not surface optional tracing shutdown failures", async () => {
    const config: Config = {
      ...baseConfig,
      langfuse: {
        enabled: true,
        publicKey: "pk-lf-test",
        secretKey: "sk-lf-test",
        sampleRate: 1,
      },
    };

    const handle = startLangfuseTracing(config, {
      createSpanProcessor: () => ({
        forceFlush: async () => {},
        onStart: () => {},
        onEnd: () => {},
        shutdown: async () => {},
      }),
      createProvider: () => ({
        register: () => {},
        shutdown: async () => {
          throw new Error("otel shutdown failed");
        },
      }),
    });

    expect(handle.enabled).toBe(true);
    await expect(handle.shutdown()).resolves.toBeUndefined();
  });
});
