import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { buildAgentForTesting } from "../src/agent/internal/loop.ts";
import {
  MAX_HISTORY,
  appendExchange,
  appendTurn,
  emptyState,
} from "../src/agent/internal/state.ts";
import type {
  LlmClient,
  LlmRequest,
  LlmResponse,
  LlmStep,
} from "../src/llm/index.ts";
import type { ToolService } from "../src/tools/index.ts";

/**
 * Stub LLM that returns scripted responses. Each item in `replies`
 * supplies the next response; `reply` builds it from the request so
 * tests can assert on what was sent.
 */
const makeStubLlm = (
  reply: (request: LlmRequest, callIndex: number) => LlmResponse,
) => {
  const calls: LlmRequest[] = [];
  let i = 0;
  const client: LlmClient = {
    generate: (request) =>
      Effect.sync(() => {
        calls.push(request);
        return reply(request, i++);
      }),
  };
  return { client, calls };
};

const text = (t: string, steps: LlmStep[] = []): LlmResponse => ({
  text: t,
  steps,
});

/**
 * Empty tool service: agent has no tools to offer the model. Used by
 * the state-only tests carried over from M2.
 */
const emptyTools: ToolService = {
  list: () => [],
  execute: (name) =>
    Effect.fail({
      _tag: "ToolError",
      tool: name,
      message: "no tools",
    } as never),
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
      return text(`echo:${last}`);
    });
    const agent = buildAgentForTesting(client, emptyTools, 5);

    const turn1 = await Effect.runPromise(
      agent.run({ userMessage: "hello", state: agent.initialState() }),
    );
    expect(turn1.reply).toBe("echo:hello");
    expect(calls[0]?.messages).toEqual([
      { role: "user", content: "hello" },
    ]);

    const turn2 = await Effect.runPromise(
      agent.run({ userMessage: "again", state: turn1.state }),
    );
    expect(turn2.reply).toBe("echo:again");
    expect(calls[1]?.messages).toEqual([
      { role: "user", content: "hello" },
      { role: "assistant", content: "echo:hello" },
      { role: "user", content: "again" },
    ]);
  });

  test("attaches the system prompt on every call", async () => {
    const { client, calls } = makeStubLlm(() => text("ok"));
    const agent = buildAgentForTesting(client, emptyTools, 5);
    await Effect.runPromise(
      agent.run({ userMessage: "x", state: agent.initialState() }),
    );
    expect(typeof calls[0]?.system).toBe("string");
    expect(calls[0]?.system).toContain("Egeria");
  });

  test("trims reply whitespace before storing", async () => {
    const { client } = makeStubLlm(() => text("  spaced  "));
    const agent = buildAgentForTesting(client, emptyTools, 5);
    const out = await Effect.runPromise(
      agent.run({ userMessage: "x", state: agent.initialState() }),
    );
    expect(out.reply).toBe("spaced");
  });
});

describe("agent.run with tools", () => {
  /**
   * Tool service that records executions and returns scripted output
   * per tool name.
   */
  const makeToolService = (
    schemas: Record<string, unknown>,
    impls: Record<string, (input: unknown) => unknown>,
  ): { svc: ToolService; calls: Array<{ name: string; input: unknown }> } => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const svc: ToolService = {
      list: () =>
        Object.keys(impls).map((name) => ({
          name,
          description: `${name} tool`,
          inputJsonSchema: schemas[name] ?? { type: "object" },
        })),
      execute: (name, input) =>
        Effect.sync(() => {
          calls.push({ name, input });
          const fn = impls[name];
          if (!fn) throw new Error("missing");
          return fn(input);
        }),
    };
    return { svc, calls };
  };

  test("offers registered tools to the LLM with maxSteps", async () => {
    const { svc } = makeToolService(
      { writeNote: { type: "object" } },
      { writeNote: () => ({ ok: true }) },
    );
    const { client, calls } = makeStubLlm(() => text("done"));
    const agent = buildAgentForTesting(client, svc, 7);

    await Effect.runPromise(
      agent.run({ userMessage: "hi", state: agent.initialState() }),
    );

    expect(calls[0]?.tools?.map((t) => t.name)).toEqual(["writeNote"]);
    expect(calls[0]?.maxSteps).toBe(7);
  });

  test("falls back when LLM returns no text but consumed all steps", async () => {
    const { svc } = makeToolService(
      { writeNote: { type: "object" } },
      { writeNote: () => ({}) },
    );
    const fakeSteps: LlmStep[] = Array.from({ length: 3 }, (_, i) => ({
      stepNumber: i,
      text: "",
      toolCalls: [{ toolName: "writeNote", input: { x: i } }],
      toolResults: [{ toolName: "writeNote", output: { ok: true } }],
      finishReason: "tool-calls",
    }));
    const { client } = makeStubLlm(() => text("", fakeSteps));
    const agent = buildAgentForTesting(client, svc, 3);

    const out = await Effect.runPromise(
      agent.run({ userMessage: "do stuff", state: agent.initialState() }),
    );
    expect(out.reply).toContain("3-step limit");
    // State still records the user/assistant pair so subsequent turns
    // see the truncated answer.
    expect(out.state.messages.at(-1)?.role).toBe("assistant");
  });

  test("invokes tools via the bridge when the LLM provides an execute closure", async () => {
    const { svc, calls: toolCalls } = makeToolService(
      { writeNote: { type: "object" } },
      { writeNote: (input) => ({ wrote: input }) },
    );
    const { client } = makeStubLlm((req) => {
      // Simulate the AI SDK invoking the bridged tool.
      const bridged = req.tools?.[0];
      if (bridged) {
        // Fire-and-forget invocation through the same closure the
        // real AI SDK would use.
        bridged.execute({ filename: "x.md", content: "y" });
      }
      return text("saved");
    });
    const agent = buildAgentForTesting(client, svc, 5);
    const out = await Effect.runPromise(
      agent.run({ userMessage: "save", state: agent.initialState() }),
    );
    expect(out.reply).toBe("saved");
    expect(toolCalls).toEqual([
      { name: "writeNote", input: { filename: "x.md", content: "y" } },
    ]);
  });
});
