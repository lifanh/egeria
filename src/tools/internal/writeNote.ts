import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { Effect } from "effect";
import { ToolError } from "../../shared/errors.ts";
import type { ToolDefinition } from "../Tool.ts";
import {
  assertContentSize,
  normalizeFilename,
  resolveSafePath,
} from "./safety.ts";
import {
  writeNoteInput,
  type WriteNoteInput,
  type WriteNoteOutput,
} from "./schemas.ts";

const TOOL = "writeNote";

/**
 * Build the writeNote tool bound to a notes directory. Defining tools
 * as factories keeps configuration injection explicit and makes
 * testing trivial.
 */
export const buildWriteNote = (
  notesDir: string,
): ToolDefinition<WriteNoteInput, WriteNoteOutput> => ({
  name: TOOL,
  description:
    "Create a Markdown note in the local notes directory. " +
    "Filename is normalized; content is plain Markdown.",
  inputSchema: writeNoteInput,
  execute: (input) =>
    Effect.tryPromise({
      try: async () => {
        const safeName = normalizeFilename(input.filename, TOOL);
        const target = resolveSafePath(notesDir, safeName, TOOL);
        assertContentSize(input.content, TOOL);
        await mkdir(dirname(target), { recursive: true });
        await Bun.write(target, input.content);
        const bytes = Buffer.byteLength(input.content, "utf8");
        return { path: target, bytes } satisfies WriteNoteOutput;
      },
      catch: (cause) => {
        if (cause instanceof ToolError) return cause;
        return new ToolError({
          tool: TOOL,
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        });
      },
    }),
});
