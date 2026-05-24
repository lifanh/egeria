import { describe, expect, test } from "bun:test";
import { buildAiSdkTelemetry } from "../src/llm/internal/telemetry.ts";

const request = {
  messages: [{ role: "user" as const, content: "hello" }],
  tools: [
    {
      name: "writeNote",
      description: "writes a note",
      inputJsonSchema: { type: "object" },
      execute: async () => ({ ok: true }),
    },
  ],
  maxSteps: 3,
};

describe("buildAiSdkTelemetry", () => {
  test("returns undefined when Langfuse tracing is disabled", () => {
    expect(
      buildAiSdkTelemetry(request, {
        enabled: false,
        modelProvider: "google-vertex",
        modelName: "gemini-2.5-flash",
      }),
    ).toBeUndefined();
  });

  test("attaches stable metadata without message contents when enabled", () => {
    expect(
      buildAiSdkTelemetry(request, {
        enabled: true,
        modelProvider: "google-vertex",
        modelName: "gemini-2.5-flash",
      }),
    ).toEqual({
      isEnabled: true,
      recordInputs: false,
      recordOutputs: false,
      functionId: "egeria.agent.generate",
      metadata: {
        app: "egeria",
        modelProvider: "google-vertex",
        modelName: "gemini-2.5-flash",
        maxSteps: 3,
        messageCount: 1,
        toolCount: 1,
        toolNames: "writeNote",
      },
    });
  });
});
