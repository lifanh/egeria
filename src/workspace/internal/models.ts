import { Effect } from "effect";
import type { AssistantMessage, AssistantMessageEvent, ProviderStreams } from "@earendil-works/pi-ai";
import { createModels, createProvider } from "@earendil-works/pi-ai/models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { LlmError } from "../../shared/errors.ts";

/** Cover the entire response, not just the provider SDK's wait for headers. */
function boundedApi(timeoutMs: number): ProviderStreams {
  const api = openAICompletionsApi();
  const bound =
    (start: ProviderStreams["stream"]): ProviderStreams["stream"] =>
    (model, transcript, options) => {
      const output = createAssistantMessageEventStream();
      let terminal: Extract<AssistantMessageEvent, { type: "done" | "error" }> | undefined;
      let partial: AssistantMessage = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: [],
        stopReason: "error",
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      };
      const request = Effect.tryPromise({
        try: async (signal) => {
          const source = start(model, transcript, {
            ...options,
            // The provider must stop its HTTP body when Effect interrupts this request.
            signal: options?.signal ? AbortSignal.any([options.signal, signal]) : signal,
            maxRetries: 0, // The harness owns retries and their durable checkpoints.
          });
          for await (const event of source) {
            if (event.type === "done") {
              partial = event.message;
              terminal = event;
            } else if (event.type === "error") {
              partial = event.error;
              terminal = event;
            } else {
              partial = event.partial;
              output.push(event);
            }
          }
          await source.result();
        },
        catch: () => new LlmError({ message: "Model stream failed", retryable: true }),
      }).pipe(
        Effect.timeoutFail({
          duration: timeoutMs,
          onTimeout: () =>
            new LlmError({
              message: `Model request timed out after ${timeoutMs} ms`,
              retryable: true,
            }),
        }),
      );
      void Effect.runPromise(
        request.pipe(
          Effect.match({
            onSuccess: () => (terminal ? output.push(terminal) : output.end(partial)),
            onFailure: (error) => {
              const message: AssistantMessage = {
                ...partial,
                stopReason: "error",
                errorMessage: error.message,
              };
              output.push({ type: "error", reason: "error", error: message });
            },
          }),
        ),
      );
      return output;
    };
  return { stream: bound(api.stream), streamSimple: bound(api.streamSimple) };
}

export function gatewayModels(config: { accountId: string; gatewayId: string; apiKey: string }, timeoutMs: number) {
  const models = createModels();
  const baseUrl = `https://gateway.ai.cloudflare.com/v1/${config.accountId}/${config.gatewayId}/compat`;
  models.setProvider(
    createProvider({
      id: "cloudflare-ai-gateway",
      name: "Cloudflare AI Gateway",
      baseUrl,
      auth: {
        apiKey: {
          name: "Gateway token",
          resolve: async () => ({
            auth: {
              apiKey: config.apiKey,
              headers: {
                "cf-aig-authorization": `Bearer ${config.apiKey}`,
                "cf-aig-collect-log-payload": "false",
              },
            },
          }),
        },
      },
      api: boundedApi(timeoutMs),
      models: [
        {
          id: "deepseek/deepseek-v4-flash",
          name: "DeepSeek V4 Flash",
          api: "openai-completions",
          provider: "cloudflare-ai-gateway",
          baseUrl,
          reasoning: false,
          input: ["text"],
          contextWindow: 128_000,
          maxTokens: 16_384,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            maxTokensField: "max_tokens",
          },
        },
      ],
    }),
  );
  return models;
}
