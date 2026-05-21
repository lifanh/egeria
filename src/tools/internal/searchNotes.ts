import { Effect } from "effect";
import type { Memory } from "../../memory/index.ts";
import { ToolError } from "../../shared/errors.ts";
import type { ToolDefinition } from "../Tool.ts";
import { searchNotesInput, type SearchNotesInput } from "./schemas.ts";

const TOOL = "searchNotes";

export interface SearchNotesOutput {
  readonly query: string;
  readonly hits: ReadonlyArray<{
    readonly filename: string;
    readonly excerpts: ReadonlyArray<string>;
  }>;
}

/**
 * Tool wrapper around `Memory.recall`. Case-insensitive keyword
 * matching with a small result cap; each hit includes short excerpts
 * so the model can ground its answer.
 */
export const buildSearchNotes = (
  memory: Memory,
): ToolDefinition<SearchNotesInput, SearchNotesOutput> => ({
  name: TOOL,
  description:
    "Search Markdown notes by keyword. Returns matching filenames with " +
    "short excerpts. Use this before answering questions that may refer to saved notes.",
  inputSchema: searchNotesInput,
  execute: (input) =>
    memory
      .recall(input.query, { limit: input.limit })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ToolError({ tool: TOOL, message: cause.message, cause }),
        ),
        Effect.map((r) => ({ query: r.query, hits: r.hits })),
      ),
});
