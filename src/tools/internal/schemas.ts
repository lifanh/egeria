import { z } from "zod";

/**
 * Input schemas for built-in tools. Kept together so the registry can
 * derive JSON schema for prompting in one place later.
 */

export const writeNoteInput = z.object({
  filename: z
    .string()
    .min(1)
    .describe("Note filename (will be normalized; .md is added if missing)"),
  content: z
    .string()
    .min(1)
    .describe("Markdown body of the note"),
});

export type WriteNoteInput = z.infer<typeof writeNoteInput>;

export const writeNoteOutput = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
});

export type WriteNoteOutput = z.infer<typeof writeNoteOutput>;
