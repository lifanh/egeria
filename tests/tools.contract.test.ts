import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { buildMemory } from "../src/memory/internal/store.ts";
import { buildReadNotes } from "../src/tools/internal/readNotes.ts";
import { buildToolService } from "../src/tools/internal/registry.ts";
import { buildSearchNotes } from "../src/tools/internal/searchNotes.ts";
import { buildWriteNote } from "../src/tools/internal/writeNote.ts";

/**
 * Contract tests exercise the tool system through its public-shaped
 * surface (`buildToolService` + tool definitions backed by a real
 * Memory) without needing the full Effect runtime.
 */

let notesDir: string;

beforeEach(async () => {
  notesDir = await mkdtemp(join(tmpdir(), "egeria-notes-"));
});

afterEach(async () => {
  await rm(notesDir, { recursive: true, force: true });
});

const makeService = () => {
  const memory = buildMemory(notesDir);
  return buildToolService(
    [
      buildWriteNote(memory),
      buildReadNotes(memory),
      buildSearchNotes(memory),
    ],
    5_000,
  );
};

const runExit = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromiseExit(effect);

describe("ToolService", () => {
  test("lists all registered tools", () => {
    const svc = makeService();
    const list = svc.list();
    expect(list.map((t) => t.name).sort()).toEqual(
      ["readNotes", "searchNotes", "writeNote"].sort(),
    );
    for (const t of list) {
      expect(typeof t.description).toBe("string");
      expect(t.inputJsonSchema).toMatchObject({ type: "object" });
    }
  });

  test("rejects unknown tool name", async () => {
    const svc = makeService();
    const exit = await runExit(svc.execute("nope", {}));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("unknown tool");
    }
  });

  test("rejects invalid input via schema", async () => {
    const svc = makeService();
    const exit = await runExit(svc.execute("writeNote", { filename: "x" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("invalid input");
    }
  });
});

describe("writeNote", () => {
  test("creates a Markdown file under NOTES_DIR and reports path", async () => {
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("writeNote", {
        filename: "first note",
        content: "# Hello\n\nbody",
      }),
    )) as { path: string; filename: string; bytes: number };

    expect(result.path).toBe(join(notesDir, "first-note.md"));
    expect(result.filename).toBe("first-note.md");
    expect(result.bytes).toBe(Buffer.byteLength("# Hello\n\nbody", "utf8"));

    const written = await readFile(result.path, "utf8");
    expect(written).toBe("# Hello\n\nbody");
  });

  test("normalizes filename: strips reserved chars, ensures .md", async () => {
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("writeNote", {
        filename: "  Some  *Title*?.md  ",
        content: "x",
      }),
    )) as { path: string };
    expect(result.path).toBe(join(notesDir, "Some-Title.md"));
  });

  test("rejects path traversal in filename", async () => {
    const svc = makeService();
    const exit = await runExit(
      svc.execute("writeNote", { filename: "../escape.md", content: "x" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("path separators");
    }
  });

  test("rejects absolute paths", async () => {
    const svc = makeService();
    const exit = await runExit(
      svc.execute("writeNote", { filename: "/tmp/evil.md", content: "x" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("path separators");
    }
  });

  test("rejects content over the size limit", async () => {
    const svc = makeService();
    const big = "a".repeat(64 * 1024 + 1);
    const exit = await runExit(
      svc.execute("writeNote", { filename: "big.md", content: big }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("exceeds");
    }
  });

  test("written file actually exists on disk", async () => {
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("writeNote", { filename: "exists.md", content: "ok" }),
    )) as { path: string };
    const s = await stat(result.path);
    expect(s.isFile()).toBe(true);
  });
});

describe("readNotes", () => {
  test("returns empty when notes dir has no .md files", async () => {
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("readNotes", {}),
    )) as { notes: unknown[]; truncated: boolean };
    expect(result.notes).toEqual([]);
    expect(result.truncated).toBe(false);
  });

  test("returns notes with content", async () => {
    await writeFile(join(notesDir, "a.md"), "alpha");
    await writeFile(join(notesDir, "b.md"), "beta");
    await writeFile(join(notesDir, "skip.txt"), "ignored");
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("readNotes", {}),
    )) as { notes: Array<{ filename: string; content: string }> };

    expect(result.notes).toHaveLength(2);
    expect(result.notes.map((n) => n.filename)).toEqual(["a.md", "b.md"]);
    expect(result.notes[0]?.content).toBe("alpha");
  });

  test("honors the limit param and reports truncation", async () => {
    for (const c of "abcde") {
      await writeFile(join(notesDir, `${c}.md`), c);
    }
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("readNotes", { limit: 2 }),
    )) as { notes: Array<{ filename: string }>; truncated: boolean };
    expect(result.notes).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });
});

describe("searchNotes", () => {
  test("finds notes by case-insensitive substring", async () => {
    await writeFile(
      join(notesDir, "study-plan.md"),
      "# Study plan\n- finish calculus today\n- review linear algebra",
    );
    await writeFile(
      join(notesDir, "groceries.md"),
      "# Groceries\n- bread\n- coffee",
    );
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("searchNotes", { query: "Calculus" }),
    )) as {
      query: string;
      hits: Array<{ filename: string; excerpts: string[] }>;
    };
    expect(result.query).toBe("Calculus");
    expect(result.hits.map((h) => h.filename)).toEqual(["study-plan.md"]);
    expect(result.hits[0]?.excerpts.join(" ")).toContain("calculus");
  });

  test("returns empty hits when nothing matches", async () => {
    await writeFile(join(notesDir, "a.md"), "alpha");
    const svc = makeService();
    const result = (await Effect.runPromise(
      svc.execute("searchNotes", { query: "zzz" }),
    )) as { hits: unknown[] };
    expect(result.hits).toEqual([]);
  });

  test("rejects too-short queries via schema", async () => {
    const svc = makeService();
    const exit = await runExit(
      svc.execute("searchNotes", { query: "a" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("invalid input");
    }
  });
});
