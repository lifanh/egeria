import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { buildToolService } from "../src/tools/internal/registry.ts";
import { buildWriteNote } from "../src/tools/internal/writeNote.ts";

/**
 * Contract tests exercise the tool system through its public-shaped
 * surface (`buildToolService` + a tool definition) without needing
 * the full Effect runtime.
 */

let notesDir: string;

beforeEach(async () => {
  notesDir = await mkdtemp(join(tmpdir(), "egeria-notes-"));
});

afterEach(async () => {
  await rm(notesDir, { recursive: true, force: true });
});

const makeService = () =>
  buildToolService([buildWriteNote(notesDir)], 5_000);

const runExit = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.runPromiseExit(effect);

describe("ToolService", () => {
  test("lists registered tools with name, description, and JSON schema", () => {
    const svc = makeService();
    const list = svc.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("writeNote");
    expect(typeof list[0]?.description).toBe("string");
    expect(list[0]?.inputJsonSchema).toMatchObject({ type: "object" });
  });

  test("rejects unknown tool name", async () => {
    const svc = makeService();
    const exit = await runExit(svc.execute("nope", {}));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const msg = JSON.stringify(exit.cause);
      expect(msg).toContain("unknown tool");
    }
  });

  test("rejects invalid input via schema", async () => {
    const svc = makeService();
    const exit = await runExit(svc.execute("writeNote", { filename: "x" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const msg = JSON.stringify(exit.cause);
      expect(msg).toContain("invalid input");
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
    )) as { path: string; bytes: number };

    expect(result.path).toBe(join(notesDir, "first-note.md"));
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
      svc.execute("writeNote", {
        filename: "../escape.md",
        content: "x",
      }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(JSON.stringify(exit.cause)).toContain(
        "path separators",
      );
    }
  });

  test("rejects absolute paths", async () => {
    const svc = makeService();
    const exit = await runExit(
      svc.execute("writeNote", {
        filename: "/tmp/evil.md",
        content: "x",
      }),
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
      svc.execute("writeNote", {
        filename: "exists.md",
        content: "ok",
      }),
    )) as { path: string };
    const s = await stat(result.path);
    expect(s.isFile()).toBe(true);
  });
});
