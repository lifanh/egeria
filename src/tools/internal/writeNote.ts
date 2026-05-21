import { Effect } from "effect";
import type { Memory } from "../../memory/index.ts";
import { ToolError } from "../../shared/errors.ts";
import type { ToolDefinition } from "../Tool.ts";
import {
  writeNoteInput,
  type WriteNoteInput,
  type WriteNoteOutput,
} from "./schemas.ts";

const TOOL = "writeNote";

/**
 * Tool wrapper around `Memory.remember`. The memory module owns the
 * notes directory, filename normalization, and size limits; this tool
 * just adapts the call shape for the LLM.
 */
export const buildWriteNote = (
  memory: Memory,
): ToolDefinition<WriteNoteInput, WriteNoteOutput> => ({
  name: TOOL,
  description:
    "Create a Markdown note in the local notes directory. " +
    "Filename is normalized; content is plain Markdown.",
  inputSchema: writeNoteInput,
  execute: (input) =>
    memory
      .remember({ title: input.filename, content: input.content })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ToolError({ tool: TOOL, message: cause.message, cause }),
        ),
      ),
});
