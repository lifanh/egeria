import type { Note, RecallHit } from "../Memory.ts";

export const DEFAULT_RECALL_LIMIT = 5;
export const DEFAULT_EXCERPTS_PER_NOTE = 2;
const MAX_EXCERPT_CHARS = 240;

/**
 * Tokenize a query into lowercased words >= 2 chars, dropping
 * duplicates. Empty queries yield an empty term list.
 */
export const tokenize = (query: string): string[] => {
  const seen = new Set<string>();
  for (const raw of query.toLowerCase().split(/\W+/)) {
    if (raw.length >= 2) seen.add(raw);
  }
  return Array.from(seen);
};

/**
 * Count how many query terms appear (case-insensitive substring) in
 * the note content. Used as a simple relevance score.
 */
const scoreNote = (note: Note, terms: string[]): number => {
  if (terms.length === 0) return 0;
  const haystack = note.content.toLowerCase();
  let hits = 0;
  for (const term of terms) {
    if (haystack.includes(term)) hits++;
  }
  return hits;
};

/**
 * Pick up to `count` short excerpts from the note that contain a
 * query term. Lines are favored to keep excerpts readable.
 */
const extractExcerpts = (
  note: Note,
  terms: string[],
  count: number,
): string[] => {
  if (terms.length === 0 || count <= 0) return [];
  const out: string[] = [];
  const lines = note.content.split(/\r?\n/);
  for (const line of lines) {
    if (out.length >= count) break;
    const lower = line.toLowerCase();
    if (terms.some((t) => lower.includes(t))) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      out.push(
        trimmed.length > MAX_EXCERPT_CHARS
          ? `${trimmed.slice(0, MAX_EXCERPT_CHARS - 1)}…`
          : trimmed,
      );
    }
  }
  return out;
};

/**
 * Pure ranking helper: given the full set of notes and a query,
 * return the top hits with excerpts. No file I/O lives here so it is
 * trivial to unit-test.
 */
export const rankHits = (
  notes: ReadonlyArray<Note>,
  query: string,
  limit: number,
  excerptsPerNote: number,
): RecallHit[] => {
  const terms = tokenize(query);
  if (terms.length === 0) return [];
  const scored = notes
    .map((note) => ({ note, score: scoreNote(note, terms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.note.filename.localeCompare(b.note.filename))
    .slice(0, limit);
  return scored.map(({ note }) => ({
    filename: note.filename,
    excerpts: extractExcerpts(note, terms, excerptsPerNote),
  }));
};
