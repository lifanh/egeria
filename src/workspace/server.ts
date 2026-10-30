import { createServer } from "node:http";
import { Effect, Layer, ManagedRuntime } from "effect";
import { parseTimeouts } from "../config/index.ts";
import { AgentError } from "../shared/errors.ts";
import { openWorkspaceRuntime } from "./internal/runtime.ts";

const timeouts = Effect.runSync(parseTimeouts(process.env));
const effects = ManagedRuntime.make(Layer.empty);
let runtime: Promise<Effect.Effect.Success<ReturnType<typeof openWorkspaceRuntime>>>;
let pending = Promise.resolve();

const server = createServer(async (request, response) => {
  // Attach synchronously: the virtual IncomingMessage emits data before the
  // first await and does not buffer it like a native Node stream.
  const body =
    request.method === "POST"
      ? new Promise<string | Error>((resolve) => {
          const chunks: Buffer[] = [];
          let bytes = 0;
          request.on("data", (chunk: Buffer) => {
            bytes += chunk.length;
            if (bytes > 256_000) resolve(new Error("Request too large"));
            else chunks.push(Buffer.from(chunk));
          });
          request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
          request.on("error", () => resolve(new Error("Request interrupted")));
        })
      : Promise.resolve("");
  // Serialize session mutations, including create vs list and delete vs submit.
  const previous = pending;
  let release!: () => void;
  pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  response.setHeader("content-type", "application/json");
  try {
    const service = await runtime;
    const result = await effects.runPromise(
      Effect.gen(function* () {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (request.method === "GET" && url.pathname === "/health") {
          return { version: process.env.EGERIA_DURABLE_VERSION, timeouts };
        } else if (request.method === "GET" && url.pathname === "/sessions") {
          return yield* service.list();
        } else if (request.method === "GET" && url.pathname === "/history") {
          return yield* service.history(url.searchParams.get("sessionId") ?? "");
        } else if (request.method === "POST") {
          const input = yield* Effect.tryPromise({
            try: async () => {
              const text = await body;
              if (text instanceof Error) throw text;
              return JSON.parse(text);
            },
            catch: () => new AgentError({ message: "Invalid workspace request" }),
          });
          if (url.pathname === "/create") return yield* service.create(input);
          if (url.pathname === "/submit") return yield* service.submit(input);
          if (url.pathname === "/delete") return yield* service.delete(input?.sessionId);
        }
        return yield* Effect.fail(new AgentError({ message: "Unknown workspace operation" }));
      }),
    );
    response.end(JSON.stringify(result ?? null));
  } catch {
    // SDK/provider errors can contain credentials. Never send them to the browser.
    response.statusCode = 400;
    response.end(
      JSON.stringify({
        _tag: "AgentError",
        error: "Workspace operation failed. Check the session name, configuration, and service state.",
      }),
    );
  } finally {
    release();
  }
});

// Acquire the unique VM port before opening any journals: two browser tabs may
// race to start us, but pi-durable storage must only ever have one process owner.
server.on("error", () => {
  process.exitCode = 1;
});
server.listen(4318, "127.0.0.1", () => {
  runtime = effects.runPromise(
    openWorkspaceRuntime({
      directory: "/home/agentos/.egeria/sessions",
      cwd: "/workspace",
      timeouts,
    }),
  );
  runtime.catch(() => {
    console.error("Failed to open the durable workspace. Check VM storage and session configuration.");
    server.close();
    process.exitCode = 1;
  });
});
