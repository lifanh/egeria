import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { MemoryError } from "../../shared/errors.ts";
import type { Note, NoteSummary } from "../Memory.ts";
import {
  assertContentSize,
  normalizeFilename,
  resolveSafePath,
} from "./paths.ts";

/**
 * Default caps for list operations. Callers may override per request,
 * but the defaults keep prompt sizes bounded by construction.
 */
export const DEFAULT_LIST_LIMIT = 20;
export const DEFAULT_LIST_MAX_BYTES = 256 * 1024;

/**
 * Write a normalized Markdown note. Creates the notes directory on
 * first use; safe against path traversal and oversize content.
 */
export const writeNote = async (
  rootDir: string,
  title: string,
  content: string,
): Promise<{ path: string; filename: string; bytes: number }> => {
  assertContentSize(content);
  const filename = normalizeFilename(title);
  const target = resolveSafePath(rootDir, filename);
  await mkdir(dirname(target), { recursive: true });
  await Bun.write(target, content);
  return {
    path: target,
    filename,
    bytes: Buffer.byteLength(content, "utf8"),
  };
};

/**
 * List `.md` files in the root. Performs no recursion: M4 keeps the
 * layout flat. Returns names sorted for stable output.
 */
const listMarkdownFilenames = async (rootDir: string): Promise<string[]> => {
  let entries: string[];
  try {
    entries = await readdir(rootDir);
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") return [];
    throw new MemoryError({
      message: `cannot read notes directory: ${err.message}`,
      cause,
    });
  }
  return entries
    .filter((name) => name.toLowerCase().endsWith(".md"))
    .sort((a, b) => a.localeCompare(b));
};

/**
 * Lightweight directory listing without reading file bodies.
 */
export const listSummaries = async (
  rootDir: string,
): Promise<NoteSummary[]> => {
  const names = await listMarkdownFilenames(rootDir);
  const out: NoteSummary[] = [];
  for (const filename of names) {
    const full = join(rootDir, filename);
    try {
      const s = await stat(full);
      if (s.isFile()) out.push({ filename, bytes: s.size });
    } catch {
      // Ignore entries that vanish between readdir and stat.
    }
  }
  return out;
};

/**
 * Read up to `limit` notes, stopping early if `maxBytes` is reached.
 * `truncated` reports whether anything was dropped to honor the caps.
 */
export const readManyNotes = async (
  rootDir: string,
  limit: number,
  maxBytes: number,
): Promise<{ notes: Note[]; truncated: boolean }> => {
  const summaries = await listSummaries(rootDir);
  const notes: Note[] = [];
  let totalBytes = 0;
  let truncated = false;

  for (const summary of summaries) {
    if (notes.length >= limit) {
      truncated = true;
      break;
    }
    if (totalBytes + summary.bytes > maxBytes) {
      truncated = true;
      break;
    }
    const full = resolveSafePath(rootDir, summary.filename);
    const content = await readFile(full, "utf8");
    notes.push({ filename: summary.filename, bytes: summary.bytes, content });
    totalBytes += summary.bytes;
  }
  return { notes, truncated };
};
