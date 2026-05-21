import { Effect } from "effect";
import type { Memory } from "../../memory/index.ts";
import { ToolError } from "../../shared/errors.ts";
import type { ToolDefinition } from "../Tool.ts";
import { readNotesInput, type ReadNotesInput } from "./schemas.ts";

const TOOL = "readNotes";

export interface ReadNotesOutput {
  readonly notes: ReadonlyArray<{
    readonly filename: string;
    readonly bytes: number;
    readonly content: string;
  }>;
  readonly truncated: boolean;
}

/**
 * Tool wrapper around `Memory.list`. Returns full note contents up to
 * the configured caps so the model can summarize them in one step.
 */
export const buildReadNotes = (
  memory: Memory,
): ToolDefinition<ReadNotesInput, ReadNotesOutput> => ({
  name: TOOL,
  description:
    "List Markdown notes in the local notes directory, returning their " +
    "full contents. Useful for summarizing what is already saved.",
  inputSchema: readNotesInput,
  execute: (input) =>
    memory
      .list({ limit: input.limit })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ToolError({ tool: TOOL, message: cause.message, cause }),
        ),
        Effect.map((r) => ({
          notes: r.notes,
          truncated: r.truncated,
        })),
      ),
});
