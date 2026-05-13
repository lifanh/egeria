import { createVertex } from "@ai-sdk/google-vertex";
import { generateText, type ModelMessage } from "ai";
import { Effect, Layer } from "effect";
import { ConfigTag, type Config } from "../../config/index.ts";
import { LlmError } from "../../shared/errors.ts";
import {
  LlmClientTag,
  type LlmClient,
  type LlmRequest,
  type LlmResponse,
} from "../LlmClient.ts";
import { withLlmRetry } from "./retryPolicy.ts";
import { withLlmTimeout } from "./timeoutPolicy.ts";

/**
 * Concrete LLM client backed by Vercel AI SDK + Google Vertex (express
 * mode using an API key). The provider, model, retry, and timeout
 * details are hidden behind the `LlmClient` interface.
 */
const buildClient = (config: Config): LlmClient => {
  const provider = createVertex({
    apiKey: config.apiKey,
    project: config.vertexProject,
    location: config.vertexLocation,
  });
  const model = provider(config.modelName);
  const timeout = withLlmTimeout(config.llmTimeoutMs);

  const generate = (request: LlmRequest): Effect.Effect<LlmResponse, LlmError> => {
    const messages: ModelMessage[] = request.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    const call = Effect.tryPromise({
      try: () =>
        generateText({
          model,
          system: request.system,
          messages,
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
      Effect.map((r) => ({ text: r.text })),
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
