import { Effect, Layer } from "effect";
import { ConfigError } from "../../shared/errors.ts";
import { ConfigTag, type Config } from "../Config.ts";
import { envSchema } from "./validation.ts";

/**
 * Read process.env, validate it, and produce a typed `Config`.
 *
 * Bun loads `.env` automatically, so no dotenv dependency is required.
 */
const loadConfig: Effect.Effect<Config, ConfigError> = Effect.try({
  try: () => {
    const parsed = envSchema.safeParse(Bun.env);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; ");
      throw new Error(`invalid environment: ${issues}`);
    }
    const e = parsed.data;
    const config: Config = {
      modelProvider: e.MODEL_PROVIDER,
      modelName: e.MODEL_NAME,
      apiKey: e.API_KEY,
      notesDir: e.NOTES_DIR,
      maxAgentSteps: e.MAX_AGENT_STEPS,
      llmTimeoutMs: e.LLM_TIMEOUT_MS,
      toolTimeoutMs: e.TOOL_TIMEOUT_MS,
      vertexProject: e.GOOGLE_VERTEX_PROJECT,
      vertexLocation: e.GOOGLE_VERTEX_LOCATION,
    };
    return config;
  },
  catch: (cause) =>
    new ConfigError({
      message: cause instanceof Error ? cause.message : String(cause),
      cause,
    }),
});

/**
 * Layer providing a validated Config built from the current environment.
 */
export const ConfigLive = Layer.effect(ConfigTag, loadConfig);
