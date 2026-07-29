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

## Open questions
- Streaming: add `--output-format stream-json` → SSE? Or ship non-stream only.
- Multi-turn: flatten transcript into one prompt vs. use `--resume`/session ids.
- Concurrency cap: serialize, or pool N subprocesses?
- Do we need tool-calling for Cognee's structured-extraction prompts, or does text suffice?
