import { Duration, Effect, Layer } from "effect";
import { z } from "zod";
import { ConfigTag } from "../../config/index.ts";
import { MemoryTag } from "../../memory/index.ts";
import { ToolError } from "../../shared/errors.ts";
import {
  ToolServiceTag,
  type ToolDefinition,
  type ToolInfo,
  type ToolService,
} from "../Tool.ts";
import { buildReadNotes } from "./readNotes.ts";
import { buildSearchNotes } from "./searchNotes.ts";
import { buildWriteNote } from "./writeNote.ts";

/**
 * Build the in-memory tool registry. The registry owns:
 *   - lookup by name
 *   - input validation
 *   - per-call timeout policy
 *
 * Callers (agent loop, tests) only see the `ToolService` surface.
 */
// Tool definitions are generic in their input/output, but the registry
// stores them in a heterogeneous map. We erase those generics here at
// the registration boundary; validation re-establishes input shape per
// call.
type AnyTool = ToolDefinition<any, unknown>;

const buildRegistry = (
  tools: ReadonlyArray<AnyTool>,
  toolTimeoutMs: number,
): ToolService => {
  const byName = new Map<string, AnyTool>();
  for (const t of tools) {
    if (byName.has(t.name)) {
      throw new Error(`duplicate tool registration: ${t.name}`);
    }
    byName.set(t.name, t);
  }

  const infos: ReadonlyArray<ToolInfo> = tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputJsonSchema: z.toJSONSchema(t.inputSchema),
  }));

  const timeout = Effect.timeoutFail({
    duration: Duration.millis(toolTimeoutMs),
    onTimeout: () =>
      new ToolError({
        tool: "(timeout)",
        message: `tool call exceeded ${toolTimeoutMs}ms timeout`,
      }),
  });

  const execute = (name: string, input: unknown) =>
    Effect.gen(function* () {
      const tool = byName.get(name);
      if (!tool) {
        return yield* Effect.fail(
          new ToolError({ tool: name, message: `unknown tool: ${name}` }),
        );
      }
      const parsed = tool.inputSchema.safeParse(input);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        return yield* Effect.fail(
          new ToolError({
            tool: name,
            message: `invalid input: ${issues}`,
          }),
        );
      }
      return yield* tool.execute(parsed.data).pipe(timeout);
    });

  return {
    list: () => infos,
    execute,
  };
};

/**
 * Default Live registry: writeNote, readNotes, searchNotes — all
 * backed by the Memory service.
 */
export const ToolsLive = Layer.effect(
  ToolServiceTag,
  Effect.gen(function* () {
    const config = yield* ConfigTag;
    const memory = yield* MemoryTag;
    const tools: AnyTool[] = [
      buildWriteNote(memory),
      buildReadNotes(memory),
      buildSearchNotes(memory),
    ];
    return buildRegistry(tools, config.toolTimeoutMs);
  }),
);

/**
 * Test helper: build a registry from explicit tool definitions.
 */
export const buildToolService = buildRegistry;
