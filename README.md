# Egeria

A small AI agent for local notes, tasks, and guided thinking. Built on
Bun, the Vercel AI SDK, and Effect.

## Setup

```bash
bun install
cp .env.example .env
# edit .env and set API_KEY to your Google Vertex (express-mode) API key
```

Get an API key from [Google AI Studio](https://aistudio.google.com/) or
the Vertex AI console.

## Run

```bash
bun run dev
```

## agentOS coding-agent runtime

The optional agentOS integration runs Pi in an isolated, durable VM actor. It
uses Node.js 24 and routes DeepSeek V4 Flash through Cloudflare AI Gateway
stored BYOK. Node.js and npm are setup prerequisites; orb setup normalizes an
existing Node installation to version 24.

```bash
# Terminal 1
AGENTOS_ALLOW_UNAUTHENTICATED_LOCAL=1 bun run agentos:server

# Terminal 2
CLOUDFLARE_API_KEY=... \
CLOUDFLARE_ACCOUNT_ID=... \
CLOUDFLARE_GATEWAY_ID=default \
bun run agentos:client
```

The client uses the durable `egeria-agent` VM and
`egeria-deepseek-v4-flash-byok-v1` session by default. This is a local-only,
single-flight smoke client: it writes Pi's provider and model configuration,
deletes any stale smoke session, opens a fresh session, verifies a unique exact
response, and deletes the session again so the Cloudflare token is not retained
in durable session state. The VM actor remains durable. The `/compat` route lets
Cloudflare inject the stored DeepSeek key.

Use a dedicated VM for this smoke test and do not run clients concurrently with
the same `AGENTOS_VM_ID`. `AGENTOS_ENDPOINT` is intentionally restricted to
loopback HTTP because `openSession` transmits the Cloudflare token. A production
remote client must use an authenticated HTTPS actor endpoint instead of this
scaffold.

### Browser workspace

Egeria also includes an orb-like browser workspace. The browser talks directly
to the agentOS actor client: agent sessions, files, and terminal commands all run
inside the durable VM rather than in the web server.

```bash
# Terminal 1: actor runtime
AGENTOS_ALLOW_UNAUTHENTICATED_LOCAL=1 bun run agentos:server

# Terminal 2: browser UI
bun run web
```

Open the web UI and connect it to `http://localhost:6420`. For a remote orb,
expose both services through authenticated HTTPS portals and set
`AGENTOS_PUBLIC_ENDPOINT` on the web service to the actor portal URL (or paste
that URL into the connection dialog). Remote deployments must also set a strong
`AGENTOS_AUTH_TOKEN` on the actor service and enter it as the connection
capability in the browser. The capability remains in memory; the browser stores
only the endpoint and VM ID. Cloudflare credentials are not placed in local
storage, but agentOS does retain the session environment as part of each durable
session; use the session delete control to remove its token. Revoking the
Cloudflare token remains the authoritative response when secure erasure matters.

The actor fails to start without one of these explicit security modes. Use
`AGENTOS_ALLOW_UNAUTHENTICATED_LOCAL=1` only for loopback development; never set
it on a remotely exposed actor.

## Optional Langfuse tracing

Egeria can send Vercel AI SDK model and tool telemetry to Langfuse. Set both
Langfuse keys in `.env` to enable tracing; leave them unset to run without
observability. Prompt and response content recording is disabled; traces include
operational metadata such as model name, message count, tool count, token usage,
and timing.

```bash
LANGFUSE_PUBLIC_KEY=pk-lf-...
LANGFUSE_SECRET_KEY=sk-lf-...
LANGFUSE_BASE_URL=https://cloud.langfuse.com
LANGFUSE_SAMPLE_RATE=1
```

Use `https://us.cloud.langfuse.com` for the US cloud region or your self-hosted
URL for `LANGFUSE_BASE_URL`. `LANGFUSE_SAMPLE_RATE` accepts `0` through `1`.
Set `LANGFUSE_LOG_LEVEL=DEBUG` temporarily if traces do not appear.

## Test

```bash
bun test
```

## Project structure

Modules expose only their `index.ts`. Implementation details live under
each module's `internal/` folder.

```
src/
  main.ts          # CLI entry; no business logic
  agent/           # public: run(input)
  tools/           # public: execute(name, input), list()
  memory/          # public: remember(event), recall(query)
  llm/             # public: generate(request)
  config/          # public: validated Config
  runtime/         # composed Effect layers
  shared/          # errors, ids, logging
```

## Status

- ✅ Milestone 0: hardcoded prompt → model response via `bun run dev`
- ✅ Milestone 1: tool system + writeNote (with path safety + tests)
- ✅ Milestone 2: conversation state (CLI chat loop + capped history + tests)
- ✅ Milestone 3: planning and tool calling (LLM-driven tool loop, max-step guard, plan/action/observation logs)
- ✅ Milestone 4: long-term memory retrieval (readNotes + searchNotes tools, memory-backed auto-recall in prompt)
- ✅ Milestone 5: reliability pass (classified LLM retry, friendly errors, per-turn recovery, request-ID logs)
