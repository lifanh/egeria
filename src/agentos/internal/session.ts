import { Effect } from "effect";
import { z } from "zod";
import { AgentError } from "../../shared/errors.ts";

const inputSchema = z.object({
  sessionId: z.string().regex(/^[a-zA-Z0-9._-]+$/).refine((id) => id !== "." && id !== ".."),
  accountId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  gatewayId: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  apiKey: z.string().min(1).refine((key) => key.trim().length > 0 && !/[\r\n]/.test(key)),
});

/**
 * One template for trusted, single-user coding sessions. This is configuration,
 * not an authorization boundary: holders of an actor capability can execute code.
 * Credentials belong only in the durable session environment, never config files.
 */
export function createSessionTemplate(input: z.input<typeof inputSchema>) {
  return Effect.gen(function* () {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success) {
      return yield* Effect.fail(new AgentError({
        message: "Invalid session configuration: check the session name, Cloudflare account/gateway IDs, and token",
      }));
    }
    const { sessionId, accountId, gatewayId, apiKey } = parsed.data;
    const home = `/home/agentos/sessions/${crypto.randomUUID()}`;
    const configDir = `${home}/.pi/agent`;
    return {
      directories: [configDir, "/workspace"],
      files: [
        {
          path: `${configDir}/models.json`,
          content: JSON.stringify({
            providers: {
              "cloudflare-ai-gateway": {
                baseUrl: `https://gateway.ai.cloudflare.com/v1/${accountId}/${gatewayId}/compat`,
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
                models: [{
                  id: "deepseek/deepseek-v4-flash",
                  name: "DeepSeek V4 Flash",
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 128_000,
                  maxTokens: 16_384,
                }],
              },
            },
          }),
        },
        {
          path: `${configDir}/settings.json`,
          content: JSON.stringify({
            defaultProvider: "cloudflare-ai-gateway",
            defaultModel: "deepseek/deepseek-v4-flash",
          }),
        },
      ],
      session: {
        sessionId,
        agent: "pi",
        cwd: "/workspace",
        permissionPolicy: "allow_all" as const,
        additionalInstructions: "You are Egeria, a careful coding agent working inside an isolated agentOS sandbox. Make concrete progress, explain important decisions succinctly, and keep all project files under /workspace.",
        env: {
          HOME: home,
          CLOUDFLARE_API_KEY: apiKey,
          CLOUDFLARE_ACCOUNT_ID: accountId,
          CLOUDFLARE_GATEWAY_ID: gatewayId,
          CLOUDFLARE_AUTHORIZATION: `Bearer ${apiKey}`,
        },
      },
    };
  });
}
