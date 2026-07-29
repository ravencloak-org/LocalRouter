# LocalRouter

An OpenAI-compatible HTTP API that routes chat calls to the real `claude` CLI, so any
OpenAI-compatible tool (Continue.dev, litellm, LangChain, or your own client) can use a
Claude Max/Pro subscription. Ships with a live Ripple.js dashboard (logs, requests, OTel
spans) and a macOS menu-bar app (login, model/effort, stop).

**Context isolation** strips Claude Code's agent context per call: ~161K → ~183 tokens,
$0.92 → $0.0006 per request, OAuth intact. See ADR-0002 + PLAN.md.

> **Why the CLI, not the API:** Anthropic bans extracting subscription OAuth tokens for
> third-party clients, but calling the genuine `claude` CLI is allowed. LocalRouter spawns
> the real CLI and never touches your token. See [ADR-0002](docs/adr/0002-claude-cli-not-oauth-token.md).
>
> **This is ToS-adjacent and not flat-rate.** It burns your Claude Code usage quota and a
> real Anthropic API key is the boring-safe path. Local, single-user use only.

## Layout

```
core/       Bun + Hono. OpenAI endpoints + /control -> claude CLI subprocess. Event bus. (ADR-0001)
web/        Ripple.js + Vite dashboard. Control bar + live /events feed over SSE.
tray/       Swift macOS menu-bar app (NSStatusItem). Drives /control. (ADR-0003)
shared/     The Event type — the only Core<->Dashboard contract.
packaging/  Homebrew cask + formula.   flake.nix  Nix (headless core).
scripts/    build.sh (compile), release-fill.sh (stamp checksums).
docs/adr/   Decisions.  CONTEXT.md  Glossary.  PLAN.md  Design.  DEPLOY.md  Distribution.
```

Control surfaces (ADR-0003): the **dashboard** is universal (all OSes); the **macOS tray**
is a native convenience. Linux/BSD/Windows use the dashboard; a Go tray for win/linux is a
later add.

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

## Use it from any OpenAI client

Point any OpenAI-compatible client at `http://localhost:8083/v1` with any API key value
(it is ignored — the CLI holds the real auth):

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:8083/v1", api_key="dummy")
client.chat.completions.create(model="claude", messages=[{"role": "user", "content": "hi"}])
```

**No embeddings.** `/v1/embeddings` returns 400 by design — the `claude` CLI has no
embedding model. Route embedding calls to a separate provider (a local embedder, OpenAI, or
Voyage). See [examples/cognee.md](examples/cognee.md) for a worked RAG setup that splits
LLM (LocalRouter) from embeddings.

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
