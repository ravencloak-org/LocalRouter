# LocalRouter

An OpenAI-compatible HTTP API that routes chat calls to the real `claude` CLI, so
OpenAI-format tools (Cognee, Continue.dev, any litellm client) can use a Claude Max/Pro
subscription. Ships with a live Ripple.js dashboard for logs, requests, and OTel spans.

> **Why the CLI, not the API:** Anthropic bans extracting subscription OAuth tokens for
> third-party clients, but calling the genuine `claude` CLI is allowed. LocalRouter spawns
> the real CLI and never touches your token. See [ADR-0002](docs/adr/0002-claude-cli-not-oauth-token.md).
>
> **This is ToS-adjacent and not flat-rate.** It burns your Claude Code usage quota and a
> real Anthropic API key is the boring-safe path. Local, single-user use only.

## Layout

```
core/    Bun + Hono. OpenAI endpoints -> claude CLI subprocess. Event bus. (ADR-0001)
web/     Ripple.js + Vite dashboard. Subscribes to /events over SSE.
shared/  The Event type — the only Core<->Dashboard contract.
docs/adr/  Decisions.  CONTEXT.md  Glossary.  PLAN.md  Design notes.
```

## Run

```bash
bun install
bun run dev      # core on :8083
bun run web      # dashboard on :5173 (proxies /v1, /events, /healthz to core)
```

Requires the `claude` CLI installed and logged in (`claude login`).

Test:
```bash
curl localhost:8083/v1/chat/completions -H 'content-type: application/json' \
  -d '{"model":"claude","messages":[{"role":"user","content":"say hi"}]}'
curl localhost:8083/healthz
```

## Point Cognee at it

```bash
LLM_PROVIDER=custom
LLM_MODEL=openai/claude
LLM_ENDPOINT=http://localhost:8083/v1
LLM_API_KEY=dummy                 # ignored; the CLI holds the real auth
EMBEDDING_ENDPOINT=http://localhost:8080/v1   # TEI — NOT LocalRouter (no embeddings here)
```

`/v1/embeddings` returns 400 by design — the CLI has no embeddings. Route them to TEI/OpenAI/Voyage.

## Config (env)

| Var | Default | |
|---|---|---|
| `LR_PORT` | 8083 | core port |
| `LR_MODEL` | sonnet | CLI model all requests map to |
| `LR_CONCURRENCY` | 4 | bounded semaphore (parallel CLI subprocesses) |
| `LR_TIMEOUT_MS` | 300000 | per-request kill deadline |
| `LR_RING` | 1000 | in-memory Event ring buffer size |

## Status: scaffold

Working: proxy core, semaphore, stream-json parse, error taxonomy, SSE event feed, healthz.
Stubbed / TODO (search `ponytail:`): real OTel SDK + OTLP export (spans synthesized now),
token throttle + focus-only subscription (emits all tokens now), stream-json schema
verification against your `claude` version, tool-calling passthrough, Ripple alpha syntax pass.
See `PLAN.md` open questions.
