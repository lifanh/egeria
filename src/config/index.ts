/**
 * Public surface of the config module.
 *
 * Other modules import only from here; they should never reach into
 * `internal/` or read environment variables directly.
 */
export { ConfigTag, type Config } from "./Config.ts";
export { ConfigLive } from "./internal/env.ts";
