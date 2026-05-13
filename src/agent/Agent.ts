import { Context, type Effect } from "effect";
import type { AgentError } from "../shared/errors.ts";

/**
 * Short-term conversation state. Kept deliberately small for now;
 * later milestones add tool-call records, retrieved memory snippets,
 * and a goal field.
 */
export interface ChatTurn {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AgentState {
  readonly messages: ReadonlyArray<ChatTurn>;
}

export interface AgentInput {
  readonly userMessage: string;
  readonly state: AgentState;
}

export interface AgentOutput {
  readonly reply: string;
  readonly state: AgentState;
}

/**
 * Public agent interface. Stateless across calls: each `run` takes the
 * current state and returns the next state alongside the reply.
 */
export interface Agent {
  readonly initialState: () => AgentState;
  readonly run: (input: AgentInput) => Effect.Effect<AgentOutput, AgentError>;
}

export class AgentTag extends Context.Tag("Agent")<AgentTag, Agent>() {}
