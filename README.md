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
