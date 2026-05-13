import { Context } from "effect";

/**
 * Public, validated runtime configuration.
 *
 * Provider-specific knobs (project, location) are exposed as optional
 * fields so the LLM module can pick them up without each business module
 * needing to care about Vertex specifics.
 */
export interface Config {
  readonly modelProvider: "google-vertex";
  readonly modelName: string;
  readonly apiKey: string;
  readonly notesDir: string;
  readonly maxAgentSteps: number;
  readonly llmTimeoutMs: number;
  readonly toolTimeoutMs: number;
  readonly vertexProject?: string;
  readonly vertexLocation?: string;
}

/**
 * Effect service tag for the validated Config. Modules that depend on
 * configuration request it via `Config` rather than touching process.env.
 */
export class ConfigTag extends Context.Tag("Config")<ConfigTag, Config>() {}
