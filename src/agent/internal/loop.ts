import { Effect, Layer } from "effect";
import { ConfigTag } from "../../config/index.ts";
import {
  LlmClientTag,
  type LlmClient,
  type LlmTool,
} from "../../llm/index.ts";
import { MemoryTag, type Memory, type RecallResult } from "../../memory/index.ts";
import { AgentError } from "../../shared/errors.ts";
import { log } from "../../shared/logging.ts";
import { ToolServiceTag, type ToolService } from "../../tools/index.ts";
import {
  AgentTag,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "../Agent.ts";
import { SYSTEM_PROMPT, buildMessages, renderRecall } from "./prompt.ts";
import { appendExchange, emptyState } from "./state.ts";

/**
 * Build the agent over concrete services. The agent:
 *   - retrieves relevant long-term memory before each LLM call (M4)
 *   - exposes registered tools to the LLM with `maxSteps` guard (M3)
 *   - logs plan / action / observation per step (M3)
 *   - threads conversation state across calls (M2)
 *
 * Tool execution is delegated to `ToolService` so safety, validation,
 * and per-call timeout policy stay centralized in the tools module.
 */
const buildAgent = (
  llm: LlmClient,
  tools: ToolService,
  memory: Memory,
  maxSteps: number,
): Agent => {
  const toolList = tools.list();

  const llmTools: LlmTool[] = toolList.map((info) => ({
    name: info.name,
    description: info.description,
    inputJsonSchema: info.inputJsonSchema,
    execute: (input) =>
      // Bridge Effect → Promise so the AI SDK can drive the tool loop.
      // Errors thrown here become tool errors visible to the model.
      Effect.runPromise(tools.execute(info.name, input)),
  }));

  return {
    initialState: emptyState,
    run: (input: AgentInput): Effect.Effect<AgentOutput, AgentError> =>
      Effect.gen(function* () {
        // Auto-retrieve from long-term memory. Failures here are
        // non-fatal: we just proceed without recalled context.
        const recall: RecallResult = yield* memory
          .recall(input.userMessage, { limit: 3, excerptsPerNote: 2 })
          .pipe(
            Effect.catchAll((cause) =>
              log
                .warn("agent.recall.failed", { message: cause.message })
                .pipe(Effect.as({ query: input.userMessage, hits: [] })),
            ),
          );

        yield* log.info("agent.step.start", {
          historyLen: input.state.messages.length,
          toolCount: llmTools.length,
          maxSteps,
          recallHits: recall.hits.length,
        });

        const systemPrompt = renderRecall(SYSTEM_PROMPT, recall);

        const response = yield* llm
          .generate({
            system: systemPrompt,
            messages: buildMessages(input.state, input.userMessage),
            tools: llmTools,
            maxSteps,
          })
          .pipe(
            Effect.mapError(
              (cause) => new AgentError({ message: cause.message, cause }),
            ),
          );

        // Log plan/action/observation per step for traceability.
        for (const step of response.steps) {
          if (step.text.length > 0) {
            yield* log.debug("agent.step.plan", {
              step: step.stepNumber,
              chars: step.text.length,
            });
          }
          for (const call of step.toolCalls) {
            yield* log.info("agent.step.action", {
              step: step.stepNumber,
              tool: call.toolName,
              input: call.input,
            });
          }
          for (const result of step.toolResults) {
            yield* log.info("agent.step.observation", {
              step: step.stepNumber,
              tool: result.toolName,
              output: result.output,
            });
          }
        }

        const reply = response.text.trim();
        if (reply.length === 0) {
          // The model stopped at the step cap without producing a final
          // text reply. Surface a helpful message rather than empty output.
          const fallback =
            response.steps.length >= maxSteps
              ? `I hit the ${maxSteps}-step limit before finishing. Could you narrow the request?`
              : "I have nothing to say.";
          const nextState = appendExchange(input.state, input.userMessage, fallback);
          yield* log.warn("agent.step.empty_reply", {
            steps: response.steps.length,
            maxSteps,
          });
          return { reply: fallback, state: nextState };
        }

        const nextState = appendExchange(input.state, input.userMessage, reply);
        yield* log.info("agent.step.done", {
          steps: response.steps.length,
          replyChars: reply.length,
        });
        return { reply, state: nextState };
      }),
  };
};

export const AgentLive = Layer.effect(
  AgentTag,
  Effect.gen(function* () {
    const llm = yield* LlmClientTag;
    const tools = yield* ToolServiceTag;
    const memory = yield* MemoryTag;
    const config = yield* ConfigTag;
    return buildAgent(llm, tools, memory, config.maxAgentSteps);
  }),
);

/**
 * Test helper: build an agent over arbitrary services and step cap.
 */
export const buildAgentForTesting = buildAgent;
