import type { LlmMessage } from "../../llm/index.ts";
import type { RecallResult } from "../../memory/index.ts";
import type { AgentState } from "../Agent.ts";

/**
 * The agent's persona and ground rules. Kept in one place so it stays
 * easy to tune without spelunking through the loop.
 */
export const SYSTEM_PROMPT =
  "You are Egeria, a focused study coach and task helper. " +
  "Be concise, ask clarifying questions only when essential, " +
  "and remember context from earlier turns in this conversation. " +
  "When relevant notes from the user's local store are provided below, " +
  "ground your answer in them and cite the filename.";

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

/**
 * Append recalled note snippets to the system prompt as a clearly
 * delimited block. Returns the prompt unchanged when no hits.
 */
export const renderRecall = (basePrompt: string, recall: RecallResult): string => {
  if (recall.hits.length === 0) return basePrompt;
  const lines: string[] = ["", "Relevant notes from the local store:"];
  for (const hit of recall.hits) {
    lines.push(`- ${hit.filename}`);
    for (const excerpt of hit.excerpts) {
      lines.push(`    • ${excerpt}`);
    }
  }
  return `${basePrompt}${lines.join("\n")}`;
};
