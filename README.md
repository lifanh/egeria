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

### Session policy and product boundaries

The browser workspace is the Pi coding-agent mode. The original `bun run dev`
notes/study assistant shares its memory implementation and validated note tools
with Pi. Its host-side notes and Langfuse tracing are not automatically copied
into the VM.

Both the browser and smoke client use `createSessionTemplate` from
`src/agentos/index.ts`. It validates session names, Cloudflare URL path
components, and tokens before provisioning, and owns the model configuration,
instructions, environment allowlist, and permission policy. Each invocation gets
a fresh Pi home directory; sessions within the same VM still share `/workspace`.
Separate homes prevent configuration collisions, not access to other sessions'
files. Session deletion does not erase the shared workspace or these home files.

This remains a trusted, single-user workspace with `allow_all` permissions.
The shared template is not server-side authorization: anyone holding the actor
capability can execute commands and create sessions directly. Do not share a VM
between untrusted users. Multi-user ownership and approval enforcement remain
future work. Tokens are kept out of generated config files, but remain in the
durable session environment until deletion; revoke tokens when erasure matters.

### Persistent notes in Pi

New browser and smoke-client sessions install a bundled CommonJS Pi extension
in their own `$HOME/.pi/agent/extensions/egeria-memory.cjs` before opening the
session. `bun run web` builds and serves this extension automatically;
`bun run agentos:client` builds it before provisioning. Existing sessions do not
upgrade automatically: create a new session to load the current extension.

Pi gains the same `writeNote`, `readNotes`, and `searchNotes` tools as the CLI.
Before each prompt, keyword recall adds matching excerpts and filenames to Pi's
system context, marked as reference data rather than instructions. Recall errors
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
  shared/          # errors, ids, logging
```

## Status

- ✅ Milestone 0: hardcoded prompt → model response via `bun run dev`
- ✅ Milestone 1: tool system + writeNote (with path safety + tests)
- ✅ Milestone 2: conversation state (CLI chat loop + capped history + tests)
- ✅ Milestone 3: planning and tool calling (LLM-driven tool loop, max-step guard, plan/action/observation logs)
- ✅ Milestone 4: long-term memory retrieval (readNotes + searchNotes tools, memory-backed auto-recall in prompt)
- ✅ Milestone 5: reliability pass (classified LLM retry, friendly errors, per-turn recovery, request-ID logs)
