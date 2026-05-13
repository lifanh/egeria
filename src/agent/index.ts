/**
 * Public surface of the agent module.
 *
 * Outside callers receive the `Agent` service and the state types they
 * need to thread between calls. Loop, prompt, and state internals are
 * hidden under `internal/`.
 */
export {
  AgentTag,
  type Agent,
  type AgentInput,
  type AgentOutput,
  type AgentState,
  type ChatTurn,
} from "./Agent.ts";
export { AgentLive } from "./internal/loop.ts";
