/**
 * Public surface of the tools module.
 *
 * Outside callers use `ToolService` (`list`, `execute`) and the
 * `ToolInfo` shape; concrete tool implementations and schemas remain
 * private.
 */
export {
  ToolServiceTag,
  type ToolInfo,
  type ToolService,
} from "./Tool.ts";
export { ToolsLive } from "./internal/registry.ts";
