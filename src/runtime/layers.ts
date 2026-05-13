import { Layer } from "effect";
import { ConfigLive } from "../config/index.ts";
import { LlmLive } from "../llm/index.ts";
import { ToolsLive } from "../tools/index.ts";

/**
 * Composed application layer. Each module exports a single `*Live`
 * layer; the runtime stitches them together so `main` (and tests) can
 * provide one combined dependency.
 *
 * `provideMerge` keeps each dependency in the resulting context so
 * other callers can also access them.
 */
export const AppLive = Layer.mergeAll(LlmLive, ToolsLive).pipe(
  Layer.provideMerge(ConfigLive),
);
