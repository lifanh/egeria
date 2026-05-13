import type { AgentState, ChatTurn } from "../Agent.ts";

/**
 * Short-term history cap. Once exceeded the oldest turns are dropped
 * so the prompt stays bounded. We keep the cap as an even number so
 * user/assistant pairs trim together.
 */
export const MAX_HISTORY = 20;

export const emptyState = (): AgentState => ({ messages: [] });

export const appendTurn = (state: AgentState, turn: ChatTurn): AgentState => {
  const next = [...state.messages, turn];
  return {
    messages: next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next,
  };
};

/**
 * Convenience for appending a user/assistant exchange in one shot.
 * Used by the loop after a model call returns.
 */
export const appendExchange = (
  state: AgentState,
  user: string,
  assistant: string,
): AgentState =>
  appendTurn(appendTurn(state, { role: "user", content: user }), {
    role: "assistant",
    content: assistant,
  });
