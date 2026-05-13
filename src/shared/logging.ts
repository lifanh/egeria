import { Effect } from "effect";

/**
 * Tiny structured logger built on Effect's logger primitives.
 *
 * Usage:
 *   yield* log.info("agent.step", { step: 1 })
 *
 * Output is JSON-friendly; we deliberately avoid a logging dependency.
 */

type Fields = Record<string, unknown>;

const emit = (
  level: "debug" | "info" | "warn" | "error",
  event: string,
  fields?: Fields,
) =>
  Effect.sync(() => {
    const line = {
      ts: new Date().toISOString(),
      level,
      event,
      ...(fields ?? {}),
    };
    const out = level === "error" || level === "warn" ? console.error : console.log;
    out(JSON.stringify(line));
  });

export const log = {
  debug: (event: string, fields?: Fields) => emit("debug", event, fields),
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};
