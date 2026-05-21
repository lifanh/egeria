import { Cause, Exit, ManagedRuntime, Option } from "effect";
import { AgentTag, type AgentState } from "./agent/index.ts";
import { AppLive } from "./runtime/index.ts";
import { newId } from "./shared/ids.ts";
import { log } from "./shared/logging.ts";
import { toUserMessage } from "./shared/userMessages.ts";

/**
 * CLI chat loop. Reads stdin lines, threads agent state across turns,
 * and prints replies. `Ctrl+D` (EOF) or `/exit` ends the session.
 *
 * Reliability:
 *   - The Effect runtime is built once via `ManagedRuntime` so layer
 *     acquisition (config validation, provider construction) happens
 *     at startup rather than once per turn.
 *   - Per-turn errors are caught and rendered as friendly messages so
 *     a transient failure doesn't kill the session.
 *   - Startup errors abort with a friendly message + exit 1.
 */
const runtime = ManagedRuntime.make(AppLive);

/**
 * Pull the original tagged error out of an Effect Cause so the
 * user-message mapping sees `{_tag, message, ...}` instead of a
 * wrapped FiberFailure.
 */
const causeToError = (cause: Cause.Cause<unknown>): unknown =>
  Option.getOrElse(
    Cause.failureOption(cause),
    () => ({ _tag: "AgentError", message: Cause.pretty(cause) }) as const,
  );

const exitFatal = async (error: unknown, event: string): Promise<never> => {
  await runtime.runPromise(
    log.error(event, {
      tag: (error as { _tag?: string })._tag,
      message: (error as { message?: string }).message,
    }),
  );
  console.error(`\n${toUserMessage(error)}\n`);
  await runtime.dispose();
  process.exit(1);
};

const agentExit = await runtime.runPromiseExit(AgentTag);
if (!Exit.isSuccess(agentExit)) {
  await exitFatal(causeToError(agentExit.cause), "agent.startup_failed");
  process.exit(1); // unreachable; keeps TS narrowing simple
}
const agent = agentExit.value;

await runtime.runPromise(log.info("agent.bootstrap", { milestone: 5 }));
console.log("Egeria ready. Type a message, or /exit to quit.");

let state: AgentState = agent.initialState();
try {
  for await (const raw of console as AsyncIterable<string>) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line === "/exit" || line === "/quit") break;

    const turnId = newId("turn");
    const started = Date.now();

    const turnExit = await runtime.runPromiseExit(
      agent.run({ userMessage: line, state }),
    );

    if (Exit.isSuccess(turnExit)) {
      state = turnExit.value.state;
      await runtime.runPromise(
        log.debug("agent.turn", {
          turnId,
          durationMs: Date.now() - started,
        }),
      );
      console.log(`\n${turnExit.value.reply}\n`);
    } else {
      const error = causeToError(turnExit.cause);
      await runtime.runPromise(
        log.error("agent.turn_failed", {
          turnId,
          durationMs: Date.now() - started,
          tag: (error as { _tag?: string })._tag,
          message: (error as { message?: string }).message,
        }),
      );
      console.log(`\n${toUserMessage(error)}\n`);
      // Keep the loop alive: a single bad turn shouldn't end the session.
    }
  }

  await runtime.runPromise(log.info("agent.shutdown"));
} finally {
  await runtime.dispose();
}
