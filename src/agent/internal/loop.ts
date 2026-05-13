import { Effect, Layer } from "effect";
import { LlmClientTag, type LlmClient } from "../../llm/index.ts";
import { AgentError } from "../../shared/errors.ts";
import { log } from "../../shared/logging.ts";
import {
  AgentTag,
  type Agent,
  type AgentInput,
  type AgentOutput,
} from "../Agent.ts";
import { SYSTEM_PROMPT, buildMessages } from "./prompt.ts";
import { appendExchange, emptyState } from "./state.ts";

/**
 * Build the agent over a concrete LlmClient. Milestone 2 implements a
 * single-step chat loop: input → llm → reply. Planning and tool
 * dispatch arrive in Milestone 3.
 */
const buildAgent = (llm: LlmClient): Agent => ({
  initialState: emptyState,
  run: (input: AgentInput): Effect.Effect<AgentOutput, AgentError> =>
    Effect.gen(function* () {
      yield* log.debug("agent.step", {
        historyLen: input.state.messages.length,
        userBytes: input.userMessage.length,
      });
      const response = yield* llm
        .generate({
          system: SYSTEM_PROMPT,
          messages: buildMessages(input.state, input.userMessage),
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new AgentError({ message: cause.message, cause }),
          ),
        );
      const reply = response.text.trim();
      const nextState = appendExchange(input.state, input.userMessage, reply);
      return { reply, state: nextState };
    }),
});

export const AgentLive = Layer.effect(
  AgentTag,
  Effect.gen(function* () {
    const llm = yield* LlmClientTag;
    return buildAgent(llm);
  }),
);

/**
 * Test helper: build an agent over an arbitrary LlmClient (e.g. a stub).
 */
export const buildAgentForTesting = buildAgent;
