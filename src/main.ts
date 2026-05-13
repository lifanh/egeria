import { Effect } from "effect";
import { LlmClientTag } from "./llm/index.ts";
import { AppLive } from "./runtime/index.ts";
import { log } from "./shared/logging.ts";

/**
 * CLI entry point. Holds no business logic of its own: composes the
 * application layer, runs a single hardcoded prompt for now (Milestone
 * 0), and prints the model response.
 *
 * Future milestones replace the hardcoded call with the agent loop.
 */
const program = Effect.gen(function* () {
  const llm = yield* LlmClientTag;
  yield* log.info("agent.bootstrap", { milestone: 0 });

  const response = yield* llm.generate({
    system: "You are Egeria, a concise study coach.",
    messages: [
      {
        role: "user",
        content: "Say hello in one short sentence and confirm you are online.",
      },
    ],
  });

  console.log(response.text);
});

const handled = program.pipe(
  Effect.provide(AppLive),
  Effect.catchAll((error) =>
    log
      .error("agent.fatal", {
        tag: (error as { _tag?: string })._tag,
        message: (error as { message?: string }).message,
      })
      .pipe(Effect.zipRight(Effect.sync(() => process.exit(1)))),
  ),
);

await Effect.runPromise(handled);
