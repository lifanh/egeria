import { describe, expect, test } from "bun:test";
import { Effect, Either } from "effect";
import { createSessionTemplate } from "../src/agentos/index.ts";

const input = {
  sessionId: "project.v2-test_1",
  accountId: "account_123",
  gatewayId: "gateway-456",
  apiKey: "test-only-gateway-token",
};

describe("agentOS session template", () => {
  test("routes Pi through the requested gateway without writing credentials into files", () => {
    const template = Effect.runSync(createSessionTemplate(input));
    const models = JSON.parse(template.files.find((file) => file.path.endsWith("/models.json"))!.content);
    const settings = JSON.parse(template.files.find((file) => file.path.endsWith("/settings.json"))!.content);
    const provider = models.providers[settings.defaultProvider];
    expect(provider.baseUrl).toBe("https://gateway.ai.cloudflare.com/v1/account_123/gateway-456/compat");
    expect(provider.models.map((model: { id: string }) => model.id)).toContain(settings.defaultModel);
    expect(settings.defaultModel).toBe("deepseek/deepseek-v4-flash");
    expect(provider.api).toBe("openai-completions");
    expect(provider.headers["cf-aig-collect-log-payload"]).toBe("false");
    expect(template.session.env[provider.apiKey as keyof typeof template.session.env]).toBe(input.apiKey);
    expect(template.session.env[provider.headers["cf-aig-authorization"] as keyof typeof template.session.env]).toBe(`Bearer ${input.apiKey}`);
    expect(JSON.stringify(template.files)).not.toContain(input.apiKey);
    expect(template.session.sessionId).toBe(input.sessionId);
    expect(template.session.agent).toBe("pi");
    expect(template.session.cwd).toBe("/workspace");
    expect(template.session.permissionPolicy).toBe("allow_all");
  });

  test("isolates Pi configuration even when a session name is reused, but shares workspace", () => {
    const first = Effect.runSync(createSessionTemplate(input));
    const second = Effect.runSync(createSessionTemplate(input));
    expect(first.session.env.HOME).not.toBe(second.session.env.HOME);
    for (const template of [first, second]) {
      expect(template.session.env.HOME).toMatch(/^\/home\/agentos\/sessions\/[a-f0-9-]+$/);
      expect(template.directories).toContain(`${template.session.env.HOME}/.pi/agent`);
      expect(template.directories).toContain("/workspace");
      for (const file of template.files) {
        expect(file.path.startsWith(`${template.session.env.HOME}/.pi/agent/`)).toBe(true);
      }
    }
  });

  test("rejects invalid names, URL injection, and empty/header-injection tokens without leaking inputs", () => {
    const invalid = [
      { sessionId: "" }, { sessionId: "." }, { sessionId: ".." },
      { sessionId: "../escape" }, { sessionId: "/absolute" },
      { accountId: "" }, { accountId: "../other" },
      { accountId: "account?override=1" }, { gatewayId: "" },
      { gatewayId: "gateway/other" }, { gatewayId: "gateway#fragment" },
      { gatewayId: "gateway%2fother" },
      { apiKey: "" }, { apiKey: "   " }, { apiKey: "secret\r\ninjected: value" },
    ];
    for (const override of invalid) {
      const result = Effect.runSync(Effect.either(createSessionTemplate({ ...input, ...override })));
      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(result.left._tag).toBe("AgentError");
        expect(JSON.stringify(result.left)).not.toContain(input.apiKey);
        expect(JSON.stringify(result.left)).not.toContain("secret");
      }
    }
  });
});
