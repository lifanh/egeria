import { Layer } from "effect";
import { AgentLive } from "../agent/index.ts";
import { ConfigLive } from "../config/index.ts";
import { LlmLive } from "../llm/index.ts";
import { MemoryLive } from "../memory/index.ts";
import { ToolsLive } from "../tools/index.ts";

/**
 * Composed application layer. Each module exports a single `*Live`
 * layer; the runtime stitches them together so `main` (and tests) can
 * provide one combined dependency.
 *
 * Order: Config underpins everything. Memory depends on Config.
 * Tools depend on Config + Memory. LLM depends on Config. Agent
 * depends on LLM + Tools + Memory + Config.
 */
const MemoryStack = MemoryLive.pipe(Layer.provideMerge(ConfigLive));
const ToolsStack = ToolsLive.pipe(Layer.provideMerge(MemoryStack));
const Services = Layer.mergeAll(LlmLive, ToolsStack);

export const AppLive = AgentLive.pipe(
  Layer.provideMerge(Services),
  Layer.provideMerge(ConfigLive),
);
