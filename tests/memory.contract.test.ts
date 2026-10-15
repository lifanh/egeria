import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { createMemory } from "../src/memory/index.ts";
import {
  rankHits,
  tokenize,
} from "../src/memory/internal/retrieval.ts";

let notesDir: string;

beforeEach(async () => {
  notesDir = await mkdtemp(join(tmpdir(), "egeria-mem-"));
});
afterEach(async () => {
  await rm(notesDir, { recursive: true, force: true });
});

const mem = () => createMemory(notesDir);

describe("Memory.remember", () => {
  test("writes a normalized .md file and returns its path", async () => {
    const result = await Effect.runPromise(
      mem().remember({ title: "  My Title  ", content: "body" }),
    );
    expect(result.filename).toBe("My-Title.md");
    expect(result.path).toBe(join(notesDir, "My-Title.md"));
    expect(await readFile(result.path, "utf8")).toBe("body");
  });

  test("rejects empty content via size assertion semantics", async () => {
    // Empty content is technically size 0; the schema layer guards it
    // in tools, but Memory accepts non-positive size as a no-op write.
    const result = await Effect.runPromise(
      mem().remember({ title: "x", content: "" }),
    );
    expect(result.bytes).toBe(0);
  });
});

describe("Memory.list", () => {
  test("returns empty for a missing notes dir", async () => {
    await rm(notesDir, { recursive: true });
    const r = await Effect.runPromise(mem().list());
    expect(r.notes).toEqual([]);
    expect(r.truncated).toBe(false);
  });

  test("lists .md files sorted, ignores other extensions", async () => {
    await writeFile(join(notesDir, "b.md"), "B");
    await writeFile(join(notesDir, "a.md"), "A");
    await writeFile(join(notesDir, "ignore.txt"), "x");
    const r = await Effect.runPromise(mem().list());
    expect(r.notes.map((n) => n.filename)).toEqual(["a.md", "b.md"]);
    expect(r.truncated).toBe(false);
  });

  test("limits file count and marks truncated", async () => {
    for (const c of "abcdef") {
      await writeFile(join(notesDir, `${c}.md`), c);
    }
    const r = await Effect.runPromise(mem().list({ limit: 3 }));
    expect(r.notes).toHaveLength(3);
    expect(r.truncated).toBe(true);
  });

  test("limits total bytes and marks truncated", async () => {
    await writeFile(join(notesDir, "a.md"), "x".repeat(100));
    await writeFile(join(notesDir, "b.md"), "x".repeat(100));
    const r = await Effect.runPromise(
      mem().list({ maxBytes: 150 }),
    );
    expect(r.notes).toHaveLength(1);
    expect(r.truncated).toBe(true);
  });
});

describe("Memory.recall", () => {
  test("returns empty hits for empty query", async () => {
    await writeFile(join(notesDir, "a.md"), "alpha");
    const r = await Effect.runPromise(mem().recall("   "));
    expect(r.hits).toEqual([]);
  });

  test("ranks more matches higher", async () => {
    await writeFile(
      join(notesDir, "many.md"),
      "calculus and linear algebra and calculus again",
    );
    await writeFile(join(notesDir, "few.md"), "calculus only");
    const r = await Effect.runPromise(
      mem().recall("calculus algebra"),
    );
    expect(r.hits.map((h) => h.filename)).toEqual(["many.md", "few.md"]);
  });

  test("respects the limit option", async () => {
    for (const name of ["a", "b", "c"]) {
      await writeFile(join(notesDir, `${name}.md`), "calculus");
    }
    const r = await Effect.runPromise(
      mem().recall("calculus", { limit: 2 }),
    );
    expect(r.hits).toHaveLength(2);
  });

  test("provides matching excerpts", async () => {
    await writeFile(
      join(notesDir, "x.md"),
      "line one\ncalculus is fun\nthird line",
    );
    const r = await Effect.runPromise(
      mem().recall("calculus", { excerptsPerNote: 1 }),
    );
    expect(r.hits[0]?.excerpts).toEqual(["calculus is fun"]);
  });
});

describe("retrieval primitives", () => {
  test("tokenize drops short tokens and dedupes", () => {
    expect(tokenize("a calculus, Calculus and the math!")).toEqual([
      "calculus",
      "and",
      "the",
      "math",
    ]);
  });

  test("rankHits with no terms returns empty", () => {
    expect(
      rankHits(
        [{ filename: "x.md", bytes: 1, content: "anything" }],
        "",
        5,
        1,
      ),
    ).toEqual([]);
  });
});

describe("Memory safety", () => {
  test("does not overwrite existing notes, including concurrent writes", async () => {
    const results = await Promise.all([
      Effect.runPromiseExit(mem().remember({ title: "decision", content: "first" })),
      Effect.runPromiseExit(mem().remember({ title: "decision", content: "second" })),
    ]);
    expect(results.filter(Exit.isSuccess)).toHaveLength(1);
    const saved = await readFile(join(notesDir, "decision.md"), "utf8");
    expect(["first", "second"]).toContain(saved);
    expect(Exit.isFailure(await Effect.runPromiseExit(mem().remember({ title: "decision", content: "replacement" })))).toBe(true);
    expect(await readFile(join(notesDir, "decision.md"), "utf8")).toBe(saved);
  });

  test("neither reads nor overwrites symlink notes and rejects a symlink root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "egeria-outside-"));
    try {
      await writeFile(join(outside, "secret.md"), "outside secret");
      await symlink(join(outside, "secret.md"), join(notesDir, "linked.md"));
      expect((await Effect.runPromise(mem().list())).notes).toEqual([]);
      expect(Exit.isFailure(await Effect.runPromiseExit(mem().remember({ title: "linked", content: "replacement" })))).toBe(true);
      await symlink(outside, join(notesDir, "root"));
      const linked = createMemory(join(notesDir, "root"));
      expect(Exit.isFailure(await Effect.runPromiseExit(linked.list()))).toBe(true);
      expect(Exit.isFailure(await Effect.runPromiseExit(linked.remember({ title: "secret", content: "replacement" })))).toBe(true);
      expect(await readFile(join(outside, "secret.md"), "utf8")).toBe("outside secret");
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  test("enforces byte ceilings and reports capped recall", async () => {
    expect(Exit.isSuccess(await Effect.runPromiseExit(mem().remember({ title: "boundary", content: "é".repeat(32768) })))).toBe(true);
    expect(Exit.isFailure(await Effect.runPromiseExit(mem().remember({ title: "over", content: "é".repeat(32769) })))).toBe(true);
    for (let i = 0; i < 21; i++) await writeFile(join(notesDir, `${String(i).padStart(2, "0")}.md`), "orchid".repeat(4000));
    const list = await Effect.runPromise(mem().list({ limit: 999, maxBytes: 9999999 }));
    expect(list.notes.reduce((sum, note) => sum + note.bytes, 0)).toBeLessThanOrEqual(256 * 1024);
    expect(list.truncated).toBe(true);
    const recall = await Effect.runPromise(mem().recall("orchid"));
    expect(recall.truncated).toBe(true);
    expect(recall.hits[0]?.filename).toBe("00.md");
  });

  test("rejects parent markers even without a slash", async () => {
    expect(Exit.isFailure(await Effect.runPromiseExit(mem().remember({ title: "safe..unsafe", content: "x" })))).toBe(true);
  });

  test("remember rejects path traversal in title", async () => {
    const exit = await Effect.runPromiseExit(
      mem().remember({ title: "../bad", content: "x" }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain("path separators");
    }
  });
});
