import { Context, type Effect } from "effect";
import type { MemoryError } from "../shared/errors.ts";

/**
 * Public memory interface. The implementation owns the notes
 * directory: filesystem layout, safety, retrieval strategy, and
 * size/file limits all live behind these calls.
 */

export interface NoteSummary {
  /** Filename relative to the notes directory. */
  readonly filename: string;
  /** Size of the note in bytes. */
  readonly bytes: number;
}

export interface Note extends NoteSummary {
  /** Full note content. */
  readonly content: string;
}

export interface RememberInput {
  /** Title used to derive the filename (will be normalized + .md). */
  readonly title: string;
  readonly content: string;
}

export interface RememberOutput {
  /** Absolute path of the file that was written. */
  readonly path: string;
  /** Filename relative to the notes directory. */
  readonly filename: string;
  readonly bytes: number;
}

export interface ListOptions {
  /** Max number of notes to return. */
  readonly limit?: number;
  /** Max total bytes across returned notes. */
  readonly maxBytes?: number;
}

export interface ListResult {
  readonly notes: ReadonlyArray<Note>;
  /** True when more notes existed but were dropped to respect limits. */
  readonly truncated: boolean;
}

export interface RecallOptions {
  /** Max number of matching notes. */
  readonly limit?: number;
  /** Max number of excerpts per note. */
  readonly excerptsPerNote?: number;
}

export interface RecallHit {
  readonly filename: string;
  readonly excerpts: ReadonlyArray<string>;
}

export interface RecallResult {
  readonly query: string;
  readonly hits: ReadonlyArray<RecallHit>;
}

export interface Memory {
  readonly remember: (input: RememberInput) => Effect.Effect<RememberOutput, MemoryError>;
  readonly list: (opts?: ListOptions) => Effect.Effect<ListResult, MemoryError>;
  readonly recall: (
    query: string,
    opts?: RecallOptions,
  ) => Effect.Effect<RecallResult, MemoryError>;
}

export class MemoryTag extends Context.Tag("Memory")<MemoryTag, Memory>() {}
