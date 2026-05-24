import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalSampleRate = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.coerce.number().min(0).max(1).default(1),
);

/**
 * Schema for the raw environment shape. Numeric fields are coerced from
 * strings since process.env values are always strings.
 *
 * Kept private to the config module: callers receive a domain-typed
 * `Config`, not a Zod schema.
 */
export const envSchema = z
  .object({
    MODEL_PROVIDER: z.literal("google-vertex").default("google-vertex"),
    MODEL_NAME: z.string().min(1).default("gemini-2.5-flash"),
    API_KEY: z.string().min(1),
    NOTES_DIR: z.string().min(1).default("./notes"),
    MAX_AGENT_STEPS: z.coerce.number().int().positive().default(5),
    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
    TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
    GOOGLE_VERTEX_PROJECT: optionalNonEmptyString,
    GOOGLE_VERTEX_LOCATION: optionalNonEmptyString,
    LANGFUSE_PUBLIC_KEY: optionalNonEmptyString,
    LANGFUSE_SECRET_KEY: optionalNonEmptyString,
    LANGFUSE_BASE_URL: optionalNonEmptyString,
    LANGFUSE_SAMPLE_RATE: optionalSampleRate,
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.LANGFUSE_PUBLIC_KEY) !== Boolean(env.LANGFUSE_SECRET_KEY)) {
      ctx.addIssue({
        code: "custom",
        message:
          "LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY must be set together",
        path: ["LANGFUSE_PUBLIC_KEY"],
      });
    }
  });

export type RawEnv = z.infer<typeof envSchema>;
