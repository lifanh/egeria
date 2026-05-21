import { ManagedRuntime } from "effect";
import { AgentTag, type AgentState } from "./agent/index.ts";
import { AppLive } from "./runtime/index.ts";
import { log } from "./shared/logging.ts";

/**
 * CLI chat loop. Reads stdin lines, threads agent state across turns,
 * and prints replies. `Ctrl+D` (EOF) or `/exit` ends the session.
 *
 * The Effect runtime is built once via `ManagedRuntime` so layer
 * acquisition (config validation, provider construction) happens at
 * startup rather than once per turn.
 */
const runtime = ManagedRuntime.make(AppLive);

const fail = async (error: unknown): Promise<never> => {
  await runtime.runPromise(
    log.error("agent.fatal", {
      tag: (error as { _tag?: string })._tag,
      message: (error as { message?: string }).message ?? String(error),
    }),
  );
  process.exit(1);
};

try {
  const agent = await runtime.runPromise(AgentTag);
  await runtime.runPromise(log.info("agent.bootstrap", { milestone: 4 }));

  console.log("Egeria ready. Type a message, or /exit to quit.");

  let state: AgentState = agent.initialState();
  for await (const raw of console as AsyncIterable<string>) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line === "/exit" || line === "/quit") break;

    const out = await runtime.runPromise(
      agent.run({ userMessage: line, state }),
    );
    state = out.state;
    console.log(`\n${out.reply}\n`);
  }

  await runtime.runPromise(log.info("agent.shutdown"));
} catch (error) {
  await fail(error);
} finally {
  await runtime.dispose();
}
