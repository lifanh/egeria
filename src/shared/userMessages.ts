import type { AppError } from "./errors.ts";

/**
 * Map an internal tagged error into a short, user-facing sentence.
 * Returns a generic fallback for unknown shapes so callers never have
 * to expose raw stack traces or provider-specific jargon.
 */
export const toUserMessage = (error: unknown): string => {
  if (error == null || typeof error !== "object") {
    return "Something unexpected happened. Please try again.";
  }
  const e = error as Partial<AppError> & { _tag?: string; message?: string };
  switch (e._tag) {
    case "ConfigError":
      return `Configuration problem: ${e.message ?? "invalid environment"}. Check your .env file.`;
    case "LlmError": {
      const llm = e as Extract<AppError, { _tag: "LlmError" }>;
      if (llm.statusCode === 401 || llm.statusCode === 403) {
        return "I couldn't authenticate with the model provider. Check your API key.";
      }
      if (llm.statusCode === 429) {
        return "The model is rate-limited right now. Please try again in a moment.";
      }
      if (llm.retryable) {
        return "I couldn't reach the model just now. Please try again.";
      }
      return `I had trouble talking to the model: ${llm.message ?? "unknown error"}.`;
    }
    case "ToolError": {
      const t = e as Extract<AppError, { _tag: "ToolError" }>;
      return `I had trouble running the ${t.tool ?? "requested"} tool: ${t.message ?? "unknown error"}.`;
    }
    case "MemoryError":
      return `I couldn't read or write your notes: ${e.message ?? "unknown error"}.`;
    case "AgentError":
      return `Something went wrong while thinking about that: ${e.message ?? "unknown error"}.`;
    default:
      return "Something unexpected happened. Please try again.";
  }
};
