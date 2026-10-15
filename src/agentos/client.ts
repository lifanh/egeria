import { createClient } from "@rivet-dev/agentos/client";
import { Effect } from "effect";
import { createSessionTemplate, type registry } from "./index.ts";
import { readFile } from "node:fs/promises";

const endpoint = process.env.AGENTOS_ENDPOINT ?? "http://localhost:6420";
const vmId = process.env.AGENTOS_VM_ID ?? "egeria-agent";
const sessionId =
  process.env.AGENTOS_SESSION_ID ?? "egeria-deepseek-v4-flash-byok-v1";
const cloudflareApiKey = process.env.CLOUDFLARE_API_KEY;
const cloudflareAccountId = process.env.CLOUDFLARE_ACCOUNT_ID;
const cloudflareGatewayId = process.env.CLOUDFLARE_GATEWAY_ID ?? "default";
const endpointUrl = new URL(endpoint);
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

if (
  endpointUrl.protocol !== "http:" ||
  !loopbackHosts.has(endpointUrl.hostname) ||
  endpointUrl.username ||
  endpointUrl.password
) {
  throw new Error(
    "The agentOS smoke client only accepts an unauthenticated loopback HTTP endpoint",
  );
}

if (!cloudflareApiKey || !cloudflareAccountId) {
  throw new Error(
    "CLOUDFLARE_API_KEY and CLOUDFLARE_ACCOUNT_ID are required to run Pi",
  );
}

const client = createClient<typeof registry>({ endpoint });
const vm = client.vm.getOrCreate(vmId);
const template = Effect.runSync(createSessionTemplate({
  sessionId,
  accountId: cloudflareAccountId,
  gatewayId: cloudflareGatewayId,
  apiKey: cloudflareApiKey,
  memoryExtension: await readFile(new URL("../../dist/egeria-memory.cjs", import.meta.url), "utf8"),
}));

await vm.deleteSession({ sessionId });
for (const directory of template.directories) {
  await vm.mkdir(directory, { recursive: true });
}
for (const file of template.files) {
  await vm.writeFile(file.path, file.content);
}

const expected = `agentos-pi-deepseek-ok-${crypto.randomUUID()}`;

try {
  await vm.openSession(template.session);

  const result = await vm.prompt({
    sessionId,
    content: [
      {
        type: "text",
        text: `Reply with exactly: ${expected}`,
      },
    ],
  });

  const response =
    result.message?.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("")
      .trim() ?? "";

  if (result.stopReason !== "end_turn" || response !== expected) {
    throw new Error(
      `Pi smoke test failed: ${response || "no text returned"} (stop reason: ${JSON.stringify(result.stopReason)})`,
    );
  }

  console.log(`agentOS response (${result.sessionId}): ${response}`);
} finally {
  await vm.deleteSession({ sessionId });
}
