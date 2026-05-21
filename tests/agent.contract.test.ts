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
import type {
  Memory,
  RecallHit,
  RecallResult,
} from "../src/memory/index.ts";
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

/** Empty tool service: agent has no tools to offer the model. */
const emptyTools: ToolService = {
  list: () => [],
  execute: (name) =>
    Effect.fail({
      _tag: "ToolError",
      tool: name,
      message: "no tools",
    } as never),
};

/** Memory stub that recalls nothing unless configured. */
const memoryStub = (hits: RecallHit[] = []): Memory => ({
  remember: () =>
    Effect.fail({
      _tag: "MemoryError",
      message: "stub",
    } as never),
  list: () => Effect.succeed({ notes: [], truncated: false }),
  recall: (query): Effect.Effect<RecallResult, never> =>
    Effect.succeed({ query, hits }),
});

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
    const agent = buildAgentForTesting(client, emptyTools, memoryStub(), 5);

    const turn1 = await Effect.runPromise(
      agent.run({ userMessage: "hello", state: agent.initialState() }),
    );
    expect(turn1.reply).toBe("echo:hello");
    expect(calls[0]?.messages).toEqual([{ role: "user", content: "hello" }]);

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
    const agent = buildAgentForTesting(client, emptyTools, memoryStub(), 5);
    await Effect.runPromise(
      agent.run({ userMessage: "x", state: agent.initialState() }),
    );
    expect(typeof calls[0]?.system).toBe("string");
    expect(calls[0]?.system).toContain("Egeria");
  });

  test("trims reply whitespace before storing", async () => {
    const { client } = makeStubLlm(() => text("  spaced  "));
    const agent = buildAgentForTesting(client, emptyTools, memoryStub(), 5);
    const out = await Effect.runPromise(
      agent.run({ userMessage: "x", state: agent.initialState() }),
    );
    expect(out.reply).toBe("spaced");
  });
});

describe("agent.run with memory recall", () => {
  test("injects recalled note snippets into the system prompt", async () => {
    const { client, calls } = makeStubLlm(() => text("ok"));
    const memory = memoryStub([
      {
        filename: "study-plan.md",
        excerpts: ["finish calculus today", "review linear algebra"],
      },
    ]);
    const agent = buildAgentForTesting(client, emptyTools, memory, 5);

    await Effect.runPromise(
      agent.run({
        userMessage: "remind me about my plan",
        state: agent.initialState(),
      }),
    );

    const sys = calls[0]?.system ?? "";
    expect(sys).toContain("Relevant notes from the local store");
    expect(sys).toContain("study-plan.md");
    expect(sys).toContain("finish calculus today");
  });

  test("does not change the prompt when nothing is recalled", async () => {
    const { client, calls } = makeStubLlm(() => text("ok"));
    const agent = buildAgentForTesting(client, emptyTools, memoryStub(), 5);
    await Effect.runPromise(
      agent.run({ userMessage: "hi", state: agent.initialState() }),
    );
    expect(calls[0]?.system).not.toContain("Relevant notes");
  });
});

describe("agent.run with tools", () => {
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
    const agent = buildAgentForTesting(client, svc, memoryStub(), 7);
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
    const agent = buildAgentForTesting(client, svc, memoryStub(), 3);
    const out = await Effect.runPromise(
      agent.run({ userMessage: "do stuff", state: agent.initialState() }),
    );
    expect(out.reply).toContain("3-step limit");
    expect(out.state.messages.at(-1)?.role).toBe("assistant");
  });

  test("invokes tools via the bridge when the LLM provides an execute closure", async () => {
    const { svc, calls: toolCalls } = makeToolService(
      { writeNote: { type: "object" } },
      { writeNote: (input) => ({ wrote: input }) },
    );
    const { client } = makeStubLlm((req) => {
      const bridged = req.tools?.[0];
      if (bridged) {
        bridged.execute({ filename: "x.md", content: "y" });
      }
      return text("saved");
    });
    const agent = buildAgentForTesting(client, svc, memoryStub(), 5);
    const out = await Effect.runPromise(
      agent.run({ userMessage: "save", state: agent.initialState() }),
    );
    expect(out.reply).toBe("saved");
    expect(toolCalls).toEqual([
      { name: "writeNote", input: { filename: "x.md", content: "y" } },
    ]);
  });
});
