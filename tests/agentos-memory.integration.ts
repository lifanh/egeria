/** Opt-in live test: Node 24, local actor, Cloudflare BYOK. Never uses a user's VM. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createClient } from "@rivet-dev/agentos/client";
import { Effect } from "effect";
import { createSessionTemplate, type registry } from "../src/agentos/index.ts";

const endpoint = process.env.AGENTOS_ENDPOINT ?? "http://localhost:6420";
const url = new URL(endpoint);
assert(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  && !url.username && !url.password && !url.search && !url.hash, "Test requires a loopback actor");
const apiKey = process.env.CLOUDFLARE_API_KEY;
const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
assert(apiKey && accountId, "Cloudflare credentials are required");
const memoryExtension = await readFile(new URL("../dist/egeria-memory.cjs", import.meta.url), "utf8");
const id = `memory-test-${crypto.randomUUID()}`;
const marker = `evidence-${crypto.randomUUID()}`;
const vm = createClient<typeof registry>({ endpoint }).vm.getOrCreate(id);
const sessions: string[] = [];
const homes: string[] = [];

async function provision(sessionId: string) {
  const template = Effect.runSync(createSessionTemplate({
    sessionId, accountId: accountId!, apiKey: apiKey!,
    gatewayId: process.env.CLOUDFLARE_GATEWAY_ID ?? "default", memoryExtension,
  }));
  homes.push(template.session.env.HOME);
  for (const directory of template.directories) await vm.mkdir(directory, { recursive: true });
  for (const file of template.files) await vm.writeFile(file.path, file.content);
  sessions.push(sessionId);
  await vm.openSession(template.session);
}

function reply(result: Awaited<ReturnType<typeof vm.prompt>>) {
  assert.equal(result.stopReason, "end_turn", "Pi must complete the turn");
  return result.message?.content.flatMap(block => block.type === "text" ? [block.text] : []).join("") ?? "";
}

try {
  await provision(`${id}-writer`);
  const written = reply(await vm.prompt({
    sessionId: sessions[0]!,
    content: [{ type: "text", text: `Use the writeNote tool (not bash/write) to create filename "verification" with content "Orchid verification code: ${marker}". Then call searchNotes with query "Orchid verification" and readNotes. If any tool fails, stop and report the error; do not retry or use fallback tools. Otherwise reply with the stored code.` }],
  }));
  assert(written.includes(marker), "Note tools must return the stored marker");
  const file = await vm.readFile("/workspace/.egeria/notes/verification.md");
  assert.equal(new TextDecoder().decode(file), `Orchid verification code: ${marker}`);
  const history = await vm.readHistory({ sessionId: sessions[0]!, limit: 500 });
  // Tool-call events, not the user's instruction text, prove the custom tools ran.
  const toolEvents = history.events.filter(event => event.type.includes("tool"));
  for (const name of ["writeNote", "searchNotes", "readNotes"]) {
    const calls = toolEvents.filter(event => JSON.stringify(event).includes(name));
    assert(calls.some(call => "toolCallId" in call && toolEvents.some(event =>
      "toolCallId" in event && event.toolCallId === call.toolCallId && "status" in event && event.status === "completed"
    )), `${name} must complete successfully in actual tool events`);
  }
  console.log("PASS: Pi loaded the extension and executed writeNote/searchNotes/readNotes");

  const reconnected = createClient<typeof registry>({ endpoint }).vm.getOrCreate(id);
  assert.equal(new TextDecoder().decode(await reconnected.readFile("/workspace/.egeria/notes/verification.md")), `Orchid verification code: ${marker}`);
  const restored = await reconnected.readHistory({ sessionId: sessions[0]!, limit: 500 });
  assert(restored.events.length > 0, "Session history survives client reconnection");
  await vm.deleteSession({ sessionId: sessions[0]! });
  await provision(`${id}-reader`);
  const recalled = reply(await reconnected.prompt({
    sessionId: sessions[1]!,
    content: [{ type: "text", text: "What is the Orchid verification code in the recalled Egeria notes? Do not call any tools; answer only from the context already supplied, including the source filename." }],
  }));
  assert(recalled.includes(marker) && recalled.includes("verification.md"), "Fresh session recall must supply the persisted note and citation");
  const readerHistory = await reconnected.readHistory({ sessionId: sessions[1]!, limit: 500 });
  assert(!readerHistory.events.some(event => event.type.includes("tool")), "Recall must work without a tool call");
  console.log("PASS: client reconnect, writer deletion, fresh-session persistence, and automatic recall");
} finally {
  for (const sessionId of sessions) await vm.deleteSession({ sessionId });
  // All paths belong to this randomly named disposable test VM.
  const cleanup = await vm.execArgv("rm", ["-rf", "--", "/workspace/.egeria", ...homes]);
  assert.equal(cleanup.exitCode, 0, "Disposable VM files must be removed");
}
