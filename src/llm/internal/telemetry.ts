import type { TelemetrySettings } from "ai";
import type { Config } from "../../config/index.ts";
import type { LlmRequest } from "../LlmClient.ts";

interface TelemetryConfig {
  readonly enabled: boolean;
  readonly modelProvider: Config["modelProvider"];
  readonly modelName: string;
}

export const buildAiSdkTelemetry = (
  request: LlmRequest,
  config: TelemetryConfig,
): TelemetrySettings | undefined => {
  if (!config.enabled) return undefined;

  return {
    isEnabled: true,
    recordInputs: false,
    recordOutputs: false,
    functionId: "egeria.agent.generate",
    metadata: {
      app: "egeria",
      modelProvider: config.modelProvider,
      modelName: config.modelName,
      maxSteps: Math.max(1, request.maxSteps ?? 1),
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
      toolNames: request.tools?.map((tool) => tool.name).join(",") ?? "",
    },
  };
};
