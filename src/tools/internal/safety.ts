import { isAbsolute, relative, resolve } from "node:path";
import { ToolError } from "../../shared/errors.ts";

/**
 * Maximum bytes accepted for a single note. Generous for prose, small
 * enough to make accidents bounded.
 */
export const MAX_NOTE_BYTES = 64 * 1024;

/**
 * Disallowed characters in user-supplied filenames. Slash variants and
 * NUL are explicitly rejected; everything else illegal on common
 * filesystems is replaced rather than rejected.
 */
const ILLEGAL_FILENAME = /[\\/\x00]/;
const REPLACEABLE = /[<>:"|?*\s]+/g;

/**
 * Normalize a user-supplied note title or filename to something safe to
 * place under the notes directory.
 *
 * Rules:
 *   - reject anything with path separators or NUL
 *   - replace whitespace and reserved chars with `-`
 *   - collapse repeats, trim leading/trailing `-` and `.`
 *   - ensure a `.md` extension
 *   - cap stem length so total path stays reasonable
 */
export const normalizeFilename = (raw: string, toolName: string): string => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new ToolError({ tool: toolName, message: "filename is empty" });
  }
  if (ILLEGAL_FILENAME.test(trimmed)) {
    throw new ToolError({
      tool: toolName,
      message: "filename must not contain path separators or NUL",
    });
  }

  const stripExt = trimmed.replace(/\.md$/i, "");
  const sanitized = stripExt
    .replace(REPLACEABLE, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  if (sanitized.length === 0) {
    throw new ToolError({
      tool: toolName,
      message: "filename has no usable characters",
    });
  }

  const stem = sanitized.slice(0, 120);
  return `${stem}.md`;
};

/**
 * Resolve `filename` against `rootDir` and assert the result stays
 * inside the root. Returns the absolute target path.
 */
export const resolveSafePath = (
  rootDir: string,
  filename: string,
  toolName: string,
): string => {
  if (isAbsolute(filename)) {
    throw new ToolError({
      tool: toolName,
      message: "absolute paths are not allowed",
    });
  }
  const root = resolve(rootDir);
  const target = resolve(root, filename);
  const rel = relative(root, target);
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
    throw new ToolError({
      tool: toolName,
      message: "path escapes notes directory",
    });
  }
  return target;
};

/**
 * Reject content larger than the configured limit.
 */
export const assertContentSize = (content: string, toolName: string): void => {
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_NOTE_BYTES) {
    throw new ToolError({
      tool: toolName,
      message: `note exceeds ${MAX_NOTE_BYTES} bytes (got ${bytes})`,
    });
  }
};
