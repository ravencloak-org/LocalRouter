# LocalRouter — Plan

## Goal
Local HTTP proxy exposing an **OpenAI-compatible API** that routes chat calls to the
real `claude` CLI (Claude Code) as a subprocess. Lets OpenAI-format tools (Cognee,
Continue.dev, any litellm client) use a Claude Max/Pro subscription without an
Anthropic API key.

## Why the CLI, not the API
- Anthropic (Jan 2026) bans extracting subscription OAuth tokens for third-party API clients.
- Calling the genuine `claude -p` CLI IS allowed — the CLI self-authenticates.
- LocalRouter spawns the real CLI; it never reads/forwards the OAuth token.

## Mechanism
1. `POST /v1/chat/completions` — flatten `messages` → prompt, pipe to
   `claude -p --output-format json --model <m>` via stdin (no shell, no injection).
2. Parse `.result` + `.usage`, reshape into OpenAI `chat.completion` schema.
3. `POST /v1/embeddings` — return 400 on purpose (CLI has no embeddings; force the
   caller to route EMBEDDING_* to TEI/OpenAI/Voyage). Prevents silent misroute.
4. `GET /v1/models` — advertise one model id.

## Scope (v0, deliberately minimal)
- Text in / text out. No tool/function-calling passthrough.
- One CLI model mapping (all requested models → one of sonnet|opus|haiku).
- **Stack (locked, see ADR-0001):** Bun + TypeScript + Hono core; Ripple.js dashboard;
  SSE feed; OTel JS. No TUI.
- Streaming: undecided (grill open question).

## Known ceilings / risks
- ToS-adjacent: still consumes Max usage quota; heavy background indexing burns it fast.
  A real API key is the boring-safe path.
- `--append-system-prompt` appends to Claude Code's agent system prompt → coding-assistant
  flavor, not a neutral raw model.
- CLI flag/JSON-key drift across `claude` versions (`input_tokens` location, flag names).
- Concurrency: each request spawns a `claude` subprocess (~cold start + quota).

## Target consumer
Cognee, self-hosted. Config:
```
LLM_PROVIDER=custom
LLM_MODEL=openai/claude
LLM_ENDPOINT=http://localhost:8083/v1
LLM_API_KEY=dummy
EMBEDDING_ENDPOINT=http://localhost:8080/v1   # TEI — NOT LocalRouter
```

## Decided
- Stateless: every Request flattens full `messages` → fresh CLI spawn, no session mapping.
  (OpenAI clients resend full context anyway; sessions add fragile fingerprint matching.)

## Backlog (addon, not v0)
- Token savers as a pre-CLI proxy layer to cut Claude Code token spend. Prior art:
  headroomlabs-ai/headroom, teamchong/pxpipe. Slots in front of the CLI bridge once the
  core + dashboard are solid.

- Concurrency: bounded semaphore, default N=4 (configurable), FIFO overflow queue. Queue
  depth emitted as an Event (Dashboard backpressure).

## Error handling (decided)
- OpenAI-shaped error envelope on every failure: `{error:{message,type,code}}` + correct HTTP.
- Taxonomy → status/type:
  - CLI missing / not logged in → 503 `cli_unavailable`
  - CLI non-zero exit / crash    → 502 `upstream_error`
  - Anthropic rate limit         → 429 `rate_limit_exceeded` (+ Retry-After)
  - Usage/quota exhausted        → 429 `usage_limit_exceeded`
  - Per-Request timeout          → 504 `timeout` (kill subprocess, release slot)
  - Malformed CLI JSON           → 502 `parse_error` (+ stderr snippet)
  - Embeddings                   → 400 `unsupported`
  - Bad request                  → 400 `invalid_request_error`
- Retry ownership: **Core does NOT retry** (Fork 1=A). Maps status + Retry-After; litellm
  owns retries. No double-retry.
- Every failure emits an Event (type + stderr snippet) to the Dashboard.
- Startup auth health-check (Fork 2): probe `claude --version` + cheap auth check on boot;
  expose `/healthz`; surface CLI-not-logged-in as a red Dashboard banner ("run claude login").

- Streaming: always spawn `--output-format stream-json`; parse token stream once; fan to
  Dashboard as Events unconditionally. Client `stream:false` → buffer → full `chat.completion`;
  `stream:true` → forward `chat.completion.chunk` SSE + `[DONE]`. Own one stream-json parser.

## Observability (decided)
- Event envelope streamed Core→Dashboard over SSE. Kinds: request | log | span | token.
- OTel instruments the Core internally (span per Request); optional OTLP export behind a
  flag. Dashboard consumes flattened `span` Events, never raw OTLP.
- Token granularity: no raw per-token by default; phase transitions + completionTokens tick
  (~250ms). Raw `token` deltas only for the focused request (on-demand). [scaffold: emits all
  tokens; throttle+focus is a TODO]
- Persistence: in-memory ring buffer (last ~1000 Events). No DB in v0. SQLite later if needed.

## Smoke-test findings (claude 2.1.206, 2026-07-29)
- Both paths verified end-to-end: non-stream + stream, event feed (queued→spawning→done+span).
- stream-json schema confirmed; parser handles it + result.is_error. Cost/cache captured to spans.
- **Context-bloat cost is the real problem.** Every spawn drags the whole global CLAUDE.md +
  all SessionStart hooks into context: ~144K cache_creation tokens. Cold call = $0.92 for "pong".
  1h cache amortizes repeats to ~$0.15. For Cognee (many calls) this is a quota/cost hazard.
  - Fix to test: spawn `claude` with an isolated config (`CLAUDE_CONFIG_DIR=<tmp>`, clean cwd,
    no project CLAUDE.md) so hooks/global memory don't load → small context per call.
  - Also what the token-saver backlog (headroom/pxpipe) targets.
- Latency ~9s/call (hook load + spawn), acceptable but hook-dominated.

## Near-term tasks
- [ ] Spike isolated-config spawn to kill the 144K context overhead.
- [ ] Wire `rate_limit_event` → pool backoff + Dashboard backpressure.
- [ ] Ripple dashboard alpha-syntax pass; token throttle + focus subscription.
- [ ] Real OTel SDK + optional OTLP export (spans synthesized now).

## Open questions
- Tool-calling: does Cognee need structured function outputs, or does text suffice?
- Per-Request timeout default (seconds). [scaffold default: 300s]
