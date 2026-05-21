import { z } from "zod";

/**
 * Input/output schemas for built-in tools. Kept together so the
 * registry can derive JSON Schema for prompting in one place.
 */

export const writeNoteInput = z.object({
  filename: z
    .string()
    .min(1)
    .describe("Note filename or title (will be normalized; .md is added if missing)"),
  content: z.string().min(1).describe("Markdown body of the note"),
});
export type WriteNoteInput = z.infer<typeof writeNoteInput>;

export const writeNoteOutput = z.object({
  path: z.string(),
  filename: z.string(),
  bytes: z.number().int().nonnegative(),
});
export type WriteNoteOutput = z.infer<typeof writeNoteOutput>;

export const readNotesInput = z.object({
  limit: z
    .number()
    .int()
    .positive()
    .max(50)
    .optional()
    .describe("Maximum number of notes to return (default 20)"),
});
export type ReadNotesInput = z.infer<typeof readNotesInput>;

export const searchNotesInput = z.object({
  query: z.string().min(2).describe("Keyword(s) to search for"),
  limit: z
    .number()
    .int()
    .positive()
    .max(20)
    .optional()
    .describe("Maximum number of matching notes to return (default 5)"),
});
export type SearchNotesInput = z.infer<typeof searchNotesInput>;
