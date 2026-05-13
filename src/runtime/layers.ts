import { Layer } from "effect";
import { AgentLive } from "../agent/index.ts";
import { ConfigLive } from "../config/index.ts";
import { LlmLive } from "../llm/index.ts";
import { ToolsLive } from "../tools/index.ts";

/**
 * Composed application layer. Each module exports a single `*Live`
 * layer; the runtime stitches them together so `main` (and tests) can
 * provide one combined dependency.
 *
 * Order: config underpins everything; llm and tools depend on config;
 * agent depends on llm (and later tools, memory).
 */
const Services = Layer.mergeAll(LlmLive, ToolsLive);

export const AppLive = AgentLive.pipe(
  Layer.provideMerge(Services),
  Layer.provideMerge(ConfigLive),
);
