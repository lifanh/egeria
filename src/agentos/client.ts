import { createClient } from "@rivet-dev/agentos/client";
import type { registry } from "./server.ts";

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
const piConfigDir = "/home/agentos/.pi/agent";

await vm.deleteSession({ sessionId });
await vm.mkdir(piConfigDir, { recursive: true });
await vm.writeFile(
  `${piConfigDir}/models.json`,
  JSON.stringify({
    providers: {
      "cloudflare-ai-gateway": {
        baseUrl: `https://gateway.ai.cloudflare.com/v1/${cloudflareAccountId}/${cloudflareGatewayId}/compat`,
        api: "openai-completions",
        apiKey: "CLOUDFLARE_API_KEY",
        headers: {
          "cf-aig-authorization": "CLOUDFLARE_AUTHORIZATION",
          "cf-aig-collect-log-payload": "false",
        },
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          maxTokensField: "max_tokens",
        },
        models: [
          {
            id: "deepseek/deepseek-v4-flash",
            name: "DeepSeek V4 Flash",
            reasoning: false,
            input: ["text"],
            contextWindow: 128_000,
            maxTokens: 16_384,
          },
        ],
      },
    },
  }),
);
await vm.writeFile(
  `${piConfigDir}/settings.json`,
  JSON.stringify({
    defaultProvider: "cloudflare-ai-gateway",
    defaultModel: "deepseek/deepseek-v4-flash",
  }),
);

const expected = `agentos-pi-deepseek-ok-${crypto.randomUUID()}`;

try {
  await vm.openSession({
    sessionId,
    agent: "pi",
    env: {
      HOME: "/home/agentos",
      CLOUDFLARE_API_KEY: cloudflareApiKey,
      CLOUDFLARE_ACCOUNT_ID: cloudflareAccountId,
      CLOUDFLARE_GATEWAY_ID: cloudflareGatewayId,
      CLOUDFLARE_AUTHORIZATION: `Bearer ${cloudflareApiKey}`,
    },
  });

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
