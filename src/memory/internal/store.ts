import { Effect, Layer } from "effect";
import { ConfigTag } from "../../config/index.ts";
import { MemoryError } from "../../shared/errors.ts";
import {
  MemoryTag,
  type ListOptions,
  type ListResult,
  type Memory,
  type RecallOptions,
  type RecallResult,
  type RememberInput,
  type RememberOutput,
} from "../Memory.ts";
import {
  DEFAULT_LIST_LIMIT,
  DEFAULT_LIST_MAX_BYTES,
  readManyNotes,
  writeNote,
} from "./fileStore.ts";
import {
  DEFAULT_EXCERPTS_PER_NOTE,
  DEFAULT_RECALL_LIMIT,
  rankHits,
} from "./retrieval.ts";

/**
 * Wrap a sync/async filesystem call in an Effect with MemoryError on
 * failure. Re-tags MemoryError thrown from path helpers so callers
 * see a uniform error type.
 */
const tryFs = <A>(thunk: () => Promise<A>) =>
  Effect.tryPromise({
    try: thunk,
    catch: (cause) => {
      if (cause instanceof MemoryError) return cause;
      return new MemoryError({
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      });
    },
  });

/**
 * Build a Memory instance bound to a notes directory. Exposed as a
 * factory so tests can construct one without the full Effect runtime.
 */
export const buildMemory = (notesDir: string): Memory => ({
  remember: (input: RememberInput): Effect.Effect<RememberOutput, MemoryError> =>
    tryFs(() => writeNote(notesDir, input.title, input.content)),

  list: (opts?: ListOptions): Effect.Effect<ListResult, MemoryError> =>
    tryFs(() =>
      readManyNotes(
        notesDir,
        opts?.limit ?? DEFAULT_LIST_LIMIT,
        opts?.maxBytes ?? DEFAULT_LIST_MAX_BYTES,
      ),
    ),

  recall: (
    query: string,
    opts?: RecallOptions,
  ): Effect.Effect<RecallResult, MemoryError> =>
    tryFs(async () => {
      const { notes } = await readManyNotes(
        notesDir,
        // Always scan the full (capped) set so ranking sees everything;
        // the caller's `limit` controls how many hits come back.
        DEFAULT_LIST_LIMIT,
        DEFAULT_LIST_MAX_BYTES,
      );
      const hits = rankHits(
        notes,
        query,
        opts?.limit ?? DEFAULT_RECALL_LIMIT,
        opts?.excerptsPerNote ?? DEFAULT_EXCERPTS_PER_NOTE,
      );
      return { query, hits };
    }),
});

export const MemoryLive = Layer.effect(
  MemoryTag,
  Effect.gen(function* () {
    const config = yield* ConfigTag;
    return buildMemory(config.notesDir);
  }),
);
