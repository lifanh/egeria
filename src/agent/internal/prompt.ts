import type { LlmMessage } from "../../llm/index.ts";
import type { AgentState } from "../Agent.ts";

/**
 * The agent's persona and ground rules. Kept in one place so it stays
 * easy to tune without spelunking through the loop.
 */
export const SYSTEM_PROMPT =
  "You are Egeria, a focused study coach and task helper. " +
  "Be concise, ask clarifying questions only when essential, " +
  "and remember context from earlier turns in this conversation.";

/**
 * Convert agent state plus the new user message into the message list
 * passed to the LLM. The system prompt is provided separately.
 */
export const buildMessages = (
  state: AgentState,
  userMessage: string,
): ReadonlyArray<LlmMessage> => [
  ...state.messages.map((m) => ({ role: m.role, content: m.content }) as LlmMessage),
  { role: "user", content: userMessage },
];
