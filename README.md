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

Egeria's browser workspace uses **@earendil-works/pi-durable** for agent
orchestration and **agentOS** for sandbox execution. The browser starts a bundled
Node service inside the VM and calls it through agentOS's `vmFetch` transport.
The web server only serves static assets; model calls, coding tools, notes,
conversations, and checkpoints all stay inside the VM.

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
only the endpoint and VM ID. Cloudflare credentials are not placed in browser
storage. The VM stores each session's gateway token in a private `config.json`
alongside its journal so interrupted work can resume. Deleting a session stops
its agent and removes its configuration and journal. Revoking the Cloudflare
token remains the authoritative response when secure erasure matters.

The actor fails to start without one of these explicit security modes. Use
`AGENTOS_ALLOW_UNAUTHENTICATED_LOCAL=1` only for loopback development; never set
it on a remotely exposed actor.

### Session policy and product boundaries

The browser uses `src/workspace/index.ts`, not agentOS's Pi session/prompt APIs.
Each session owns a pi-durable harness backed by append-only JSONL storage under
`/home/agentos/.egeria/sessions/<name>/journal`. JSONL avoids native SQLite
bindings in the virtual Node runtime; its in-memory index grows with history.
One VM-local service owns all harnesses, and acquires port 4318 before opening
storage to prevent concurrent writers. Do not expose this port directly: access
goes through the authenticated actor capability.

New sessions publish their configuration with an atomic directory rename.
Recovery skips incomplete or damaged sessions and logs `workspace.session.unavailable`
without deleting their data or blocking healthy sessions. Interrupted staging
directories stay outside the session scan and can be removed after inspection.

Closing or reloading the browser does not cancel an accepted run. Reconnecting
starts the service if needed and resumes unfinished work from stored checkpoints.
Submission request IDs prevent duplicate admission. Unsafe interrupted tools are
not automatically replayed. Runs execute at most five tools, with a friendly
limit notice. Set `LLM_TIMEOUT_MS` and `TOOL_TIMEOUT_MS` on the web service;
validated values are passed into the VM at startup (defaults: thirty and ten
seconds). The model deadline covers the complete stream, including stalled
response bodies, and aborts the provider request. Automatic pi-durable compaction
bounds model context, not the stored transcript. Structured plan/action/observation
logs omit content.

`bun run web` builds the service automatically. Builds are fingerprinted; if a
VM already runs another build or different timeout settings, stop that durable
Node process through agentOS before reconnecting to upgrade. Existing agentOS Pi
sessions are left untouched and are not imported into the new browser session
list. They remain accessible through the legacy agentOS APIs.

The original `bun run dev` assistant and `bun run agentos:client` smoke client
are unchanged. The latter still uses `createSessionTemplate` and the older Pi
extension. Host-side notes and Langfuse tracing are not copied into the VM.

This remains a trusted, single-user workspace. Anyone holding the actor
capability can execute code and read VM files, including other sessions' tokens.
The coding tools are not an authorization boundary. Do not share a VM between
untrusted users. Deleting a session leaves shared workspace files and notes;
revoking its token is necessary when secure erasure matters.

### Persistent notes in Pi

The browser's pi-durable registry installs the same `writeNote`, `readNotes`,
and `searchNotes` tools as the CLI, alongside the built-in read/write/edit/bash
coding tools. Before each model request, keyword recall adds matching excerpts
and filenames to system context, marked as reference data rather than instructions. Recall errors
produce an explicit unavailable notice rather than silently claiming success.
No vector database is used.

Notes live in `/workspace/.egeria/notes`, shared by all sessions in one VM and
separate from per-session Pi configuration. Reconnecting the browser or deleting
a session does not delete notes; a different VM has a different notes store.
Host-side `NOTES_DIR` files are not imported automatically. Do not store secrets
in notes: matching excerpts are sent to the model through the configured gateway.

`writeNote` now creates new files only, for both CLI and Pi. An existing normalized
filename is an error, not an overwrite; use a new title for updates. Each write
is capped at 64 KiB. Note tools reject traversal and symlink roots, skip symlink
entries on listing, and open reads without following final-component symlinks.
These guards do not restrict an agent's separate shell or file tools in this
trusted single-user VM.

Reads default to 20 notes and never exceed 50 notes or 256 KiB of content.
Recall scans at most 20 alphabetically ordered notes / 256 KiB, returns five
hits by default, and includes at most two 240-character excerpts per hit.
Results report `truncated` when the input scan is capped; a search may therefore
omit later files. Tool calls and automatic recall have a ten-second timeout.
Cancellation prevents already-aborted calls from starting; an in-flight
filesystem write is not transactional and may finish after cancellation.

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

This includes bundled-extension tests using Pi's actual tool-schema validator,
tool execution and recall against temporary files, plus memory safety regressions.
Type-check and build with `bunx tsc --noEmit` and `bun run web:build`.

For the live VM test, start a loopback actor as shown above and provide
`CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, and optionally
`CLOUDFLARE_GATEWAY_ID` in the environment, then run:

```bash
bun run test:agentos-memory
```

This opt-in test uses the real Pi/agentOS VM and gateway (billable model calls).
It creates a unique disposable VM, checks actual note tool events and file
contents, reconnects the client, deletes the writer session, and verifies a fresh
session recalls the note without calling tools. It deletes its sessions and test
files afterward; the empty VM actor may remain. It does not restart the actor
server or simulate storage loss. It is not part of the offline `bun test` suite.

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
  workspace/       # pi-durable browser sessions hosted inside the agentOS VM
  shared/          # errors, ids, logging
```

## Status

- ✅ Milestone 0: hardcoded prompt → model response via `bun run dev`
- ✅ Milestone 1: tool system + writeNote (with path safety + tests)
- ✅ Milestone 2: conversation state (CLI chat loop + capped history + tests)
- ✅ Milestone 3: planning and tool calling (LLM-driven tool loop, max-step guard, plan/action/observation logs)
- ✅ Milestone 4: long-term memory retrieval (readNotes + searchNotes tools, memory-backed auto-recall in prompt)
- ✅ Milestone 5: reliability pass (classified LLM retry, friendly errors, per-turn recovery, request-ID logs)
