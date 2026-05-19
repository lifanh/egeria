import { createVertex } from "@ai-sdk/google-vertex";
import {
  dynamicTool,
  generateText,
  jsonSchema,
  stepCountIs,
  type ModelMessage,
  type ToolSet,
} from "ai";
import { Effect, Layer } from "effect";
import { ConfigTag, type Config } from "../../config/index.ts";
import { LlmError } from "../../shared/errors.ts";
import {
  LlmClientTag,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
  type LlmStep,
  type LlmTool,
} from "../LlmClient.ts";
import { withLlmRetry } from "./retryPolicy.ts";
import { withLlmTimeout } from "./timeoutPolicy.ts";

/**
 * Concrete LLM client backed by Vercel AI SDK + Google Vertex (express
 * mode using an API key). The provider, model, retry, timeout, and
 * tool-loop details are hidden behind the `LlmClient` interface.
 */
const buildClient = (config: Config): LlmClient => {
  const provider = createVertex({
    apiKey: config.apiKey,
    project: config.vertexProject,
    location: config.vertexLocation,
  });
  const model = provider(config.modelName);
  const timeout = withLlmTimeout(config.llmTimeoutMs);

  const wrapTools = (tools: ReadonlyArray<LlmTool> | undefined): ToolSet => {
    if (!tools || tools.length === 0) return {};
    const entries = tools.map((t) => [
      t.name,
      dynamicTool({
        description: t.description,
        inputSchema: jsonSchema(t.inputJsonSchema as Record<string, unknown>),
        execute: async (input) => t.execute(input),
      }),
    ]);
    return Object.fromEntries(entries) as ToolSet;
  };

  const generate = (request: LlmRequest): Effect.Effect<LlmResponse, LlmError> => {
    const messages: ModelMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const aiTools = wrapTools(request.tools);
    const maxSteps = Math.max(1, request.maxSteps ?? 1);

    const call = Effect.tryPromise({
      try: () =>
        generateText({
          model,
          system: request.system,
          messages,
          tools: aiTools,
          stopWhen: stepCountIs(maxSteps),
        }),
      catch: (cause) =>
        new LlmError({
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });

    return call.pipe(
      withLlmRetry,
      timeout,
      Effect.map((result) => {
        const steps: LlmStep[] = result.steps.map((s, i) => ({
          stepNumber: s.stepNumber ?? i,
          text: s.text ?? "",
          toolCalls: s.toolCalls.map((c) => ({
            toolName: c.toolName,
            input: c.input as unknown,
          })),
          toolResults: s.toolResults.map((r) => ({
            toolName: r.toolName,
            output: r.output as unknown,
          })),
          finishReason: String(s.finishReason),
        }));
        return { text: result.text, steps } satisfies LlmResponse;
      }),
    );
  };

  return { generate };
};

export const LlmLive = Layer.effect(
  LlmClientTag,
  Effect.gen(function* () {
    const config = yield* ConfigTag;
    return buildClient(config);
  }),
);
