import { z } from "zod";

/**
 * Schema for the raw environment shape. Numeric fields are coerced from
 * strings since process.env values are always strings.
 *
 * Kept private to the config module: callers receive a domain-typed
 * `Config`, not a Zod schema.
 */
export const envSchema = z.object({
  MODEL_PROVIDER: z.literal("google-vertex").default("google-vertex"),
  MODEL_NAME: z.string().min(1).default("gemini-2.5-flash"),
  API_KEY: z.string().min(1),
  NOTES_DIR: z.string().min(1).default("./notes"),
  MAX_AGENT_STEPS: z.coerce.number().int().positive().default(5),
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  GOOGLE_VERTEX_PROJECT: z.string().min(1).optional(),
  GOOGLE_VERTEX_LOCATION: z.string().min(1).optional(),
});

export type RawEnv = z.infer<typeof envSchema>;
