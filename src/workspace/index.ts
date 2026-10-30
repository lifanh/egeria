import type { createClient } from "@rivet-dev/agentos/client";
import { Effect } from "effect";
import type { registry } from "../agentos/index.ts";
import { parseTimeouts, type Timeouts } from "../config/index.ts";
import { AgentError } from "../shared/errors.ts";

type Vm = Pick<
  ReturnType<ReturnType<typeof createClient<typeof registry>>["vm"]["getOrCreate"]>,
  "vmFetch" | "mkdir" | "writeFile" | "spawn"
>;

export interface WorkspaceSession {
  sessionId: string;
  updatedAt: string;
  status: "idle" | "running";
}

export interface WorkspaceMessage {
  role: "user" | "agent";
  text: string;
}

export interface WorkspaceHistory {
  messages: WorkspaceMessage[];
  truncated: boolean;
  status: "idle" | "running";
  failure?: string;
}

export interface SessionConfiguration {
  sessionId: string;
  accountId: string;
  gatewayId: string;
  apiKey: string;
}

const port = 4318;
const directory = "/home/agentos/.egeria";

/** Agent orchestration runs in the VM; the browser only uses its HTTP transport. */
export function connectWorkspace(vm: Vm, bundle: string, timeouts?: Timeouts) {
  return Effect.gen(function* () {
    const deadlines = yield* parseTimeouts({
      LLM_TIMEOUT_MS: timeouts?.llmTimeoutMs,
      TOOL_TIMEOUT_MS: timeouts?.toolTimeoutMs,
    });
    const digest = yield* Effect.tryPromise({
      try: () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(bundle)),
      catch: () =>
        new AgentError({
          message: "Could not fingerprint the workspace service",
        }),
    });
    const version = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    function request<T>(path: string, body?: unknown) {
      return Effect.tryPromise({
        try: async () => {
          const response = await vm.vmFetch(port, `http://127.0.0.1:${port}${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: { "content-type": "application/json" },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
          const result = JSON.parse(new TextDecoder().decode(response.body));
          if (response.status !== 200)
            throw new AgentError({
              message: "Workspace operation failed. Check the session name, configuration, and service state.",
            });
          return result as T;
        },
        catch: () =>
          new AgentError({
            message: "Workspace operation failed. Check the session name, configuration, and service state.",
          }),
      });
    }

    const probe = request<{ version: string; timeouts: Timeouts }>("/health").pipe(
      Effect.catchTag("AgentError", () => Effect.succeed(undefined)),
    );
    let health = yield* probe;
    if (!health) {
      const path = `${directory}/durable-${version}.cjs`;
      yield* Effect.tryPromise({
        try: async () => {
          await vm.mkdir(directory, { recursive: true });
          await vm.writeFile(path, bundle);
          await vm.spawn("node", [path], {
            cwd: "/workspace",
            env: {
              EGERIA_DURABLE_VERSION: version,
              LLM_TIMEOUT_MS: String(deadlines.llmTimeoutMs),
              TOOL_TIMEOUT_MS: String(deadlines.toolTimeoutMs),
            },
          });
        },
        catch: () =>
          new AgentError({
            message: "Could not start the pi-durable service inside the VM",
          }),
      });
      for (let attempt = 0; attempt < 60; attempt++) {
        health = yield* probe;
        if (health) break;
        yield* Effect.sleep(500);
      }
      if (!health)
        return yield* Effect.fail(
          new AgentError({
            message: "The pi-durable service did not start inside the VM",
          }),
        );
    }
    if (
      health.version !== version ||
      health.timeouts?.llmTimeoutMs !== deadlines.llmTimeoutMs ||
      health.timeouts?.toolTimeoutMs !== deadlines.toolTimeoutMs
    ) {
      return yield* Effect.fail(
        new AgentError({
          message:
            "This VM runs a different workspace build or timeout configuration. Stop its durable service in agentOS before reconnecting to upgrade.",
        }),
      );
    }

    return {
      listSessions: () => request<WorkspaceSession[]>("/sessions"),
      createSession: (config: SessionConfiguration) => request<void>("/create", config),
      deleteSession: (sessionId: string) => request<void>("/delete", { sessionId }),
      history: (sessionId: string) => request<WorkspaceHistory>(`/history?sessionId=${encodeURIComponent(sessionId)}`),
      submit: (sessionId: string, text: string, requestId: string) =>
        request<{ submissionId: string }>("/submit", {
          sessionId,
          text,
          requestId,
        }),
    };
  });
}

export type Workspace = Effect.Effect.Success<ReturnType<typeof connectWorkspace>>;
