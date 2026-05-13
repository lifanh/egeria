import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { buildAgentForTesting } from "../src/agent/internal/loop.ts";
import {
  MAX_HISTORY,
  appendExchange,
  appendTurn,
  emptyState,
} from "../src/agent/internal/state.ts";
import type { LlmClient, LlmRequest } from "../src/llm/index.ts";

/**
 * Stub LLM that records what it was called with and returns a
 * deterministic reply. Used to verify state threading without
 * touching a real provider.
 */
const makeStubLlm = (
  reply: (request: LlmRequest) => string = () => "ok",
) => {
  const calls: LlmRequest[] = [];
  const client: LlmClient = {
    generate: (request) =>
      Effect.sync(() => {
        calls.push(request);
        return { text: reply(request) };
      }),
  };
  return { client, calls };
};

describe("agent state", () => {
  test("emptyState has no messages", () => {
    expect(emptyState().messages).toEqual([]);
  });

  test("appendTurn appends in order", () => {
    const s = appendTurn(
      appendTurn(emptyState(), { role: "user", content: "a" }),
      { role: "assistant", content: "b" },
    );
    expect(s.messages.map((m) => m.content)).toEqual(["a", "b"]);
  });

  test("appendTurn caps history at MAX_HISTORY (drops oldest)", () => {
    let s = emptyState();
    for (let i = 0; i < MAX_HISTORY + 5; i++) {
      s = appendTurn(s, { role: "user", content: String(i) });
    }
    expect(s.messages).toHaveLength(MAX_HISTORY);
    // The oldest 5 should have been dropped.
    expect(s.messages[0]?.content).toBe("5");
    expect(s.messages.at(-1)?.content).toBe(String(MAX_HISTORY + 4));
  });

  test("appendExchange records both turns in order", () => {
    const s = appendExchange(emptyState(), "hi", "hello");
    expect(s.messages).toEqual([
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("agent.run", () => {
  test("threads previous turns into the LLM request", async () => {
    const { client, calls } = makeStubLlm((req) => {
      const last = req.messages.at(-1)?.content ?? "";
      return `echo:${last}`;
    });
    const agent = buildAgentForTesting(client);

    const turn1 = await Effect.runPromise(
      agent.run({ userMessage: "hello", state: agent.initialState() }),
    );
    expect(turn1.reply).toBe("echo:hello");
    // First call sees only the new user message.
    expect(calls[0]?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);
    // State now has the user/assistant pair.
    expect(turn1.state.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "echo:hello" },
    ]);

    const turn2 = await Effect.runPromise(
      agent.run({ userMessage: "again", state: turn1.state }),
    );
    expect(turn2.reply).toBe("echo:again");
    // Second call sees the full prior history plus the new user message.
    expect(calls[1]?.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "echo:hello" },
      { role: "user", content: "again" },
    ]);
  });

  test("attaches the system prompt on every call", async () => {
    const { client, calls } = makeStubLlm();
    const agent = buildAgentForTesting(client);
    await Effect.runPromise(
      agent.run({ userMessage: "x", state: agent.initialState() }),
    );
    expect(typeof calls[0]?.system).toBe("string");
    expect(calls[0]?.system).toContain("Egeria");
  });

  test("trims reply whitespace before storing", async () => {
    const { client } = makeStubLlm(() => "  spaced  ");
    const agent = buildAgentForTesting(client);
    const out = await Effect.runPromise(
      agent.run({ userMessage: "x", state: agent.initialState() }),
    );
    expect(out.reply).toBe("spaced");
    expect(out.state.messages.at(-1)?.content).toBe("spaced");
  });

  test("history cap applies after long conversations", async () => {
    const { client } = makeStubLlm(() => "r");
    const agent = buildAgentForTesting(client);
    let state = agent.initialState();
    for (let i = 0; i < MAX_HISTORY; i++) {
      const out = await Effect.runPromise(
        agent.run({ userMessage: `q${i}`, state }),
      );
      state = out.state;
    }
    expect(state.messages.length).toBeLessThanOrEqual(MAX_HISTORY);
  });
});
