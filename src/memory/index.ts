/**
 * Public surface of the memory module.
 *
 * Owns the notes directory: filesystem layout, safety, retrieval
 * strategy, and limits all live behind these calls.
 */
export {
  MemoryTag,
  type ListOptions,
  type ListResult,
  type Memory,
  type Note,
  type NoteSummary,
  type RecallHit,
  type RecallOptions,
  type RecallResult,
  type RememberInput,
  type RememberOutput,
} from "./Memory.ts";
export { MemoryLive } from "./internal/store.ts";
