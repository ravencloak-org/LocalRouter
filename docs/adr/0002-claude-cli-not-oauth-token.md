# 2. Route via the `claude` CLI subprocess, not the OAuth token

Date: 2026-07-29

## Status

Accepted

## Context

To let an OpenAI-format tool use a Claude Max/Pro subscription, LocalRouter must reach
Anthropic somehow. Two mechanisms exist:

1. **Extract the OAuth token** from `~/.claude` and call `api.anthropic.com` directly as a
   custom API client.
2. **Spawn the real `claude` CLI** (`claude -p ...`) and let it authenticate itself.

Anthropic enforced its Terms of Service in January 2026: subscription OAuth tokens are
"only authorized for use with Claude Code." Third-party harnesses that extracted tokens
(early OpenClaw, others) were blocked, with mass account bans and a ~3% appeal-overturn
rate. Calling the genuine CLI remains explicitly allowed - it is the tool Anthropic
authorized. This is how Block's Buzz drives Claude Code (over ACP, spawning the real agent).

## Decision

Route exclusively by spawning the genuine `claude` CLI as a subprocess. LocalRouter never
reads, stores, or forwards the OAuth token. The CLI self-authenticates against the
signed-in subscription, exactly as an interactive terminal session would.

## Consequences

- Stays on Anthropic's allowed side; to their servers it looks like ordinary Claude Code use.
- Inherits Claude Code's usage limits and rate caps - **not flat-rate**. Heavy background
  load (e.g. Cognee indexing) burns the subscription quota fast.
- Still ToS-*adjacent*: sanctioned mechanism, unsanctioned intent (feeding a non-Anthropic
  tool). A real Anthropic API key remains the boring-safe path for production/automation.
- **No embeddings.** The CLI has no embedding endpoint and Anthropic ships no first-party
  embedding model. `/v1/embeddings` returns HTTP 400 by design so a misrouted embedding
  call is loud, not silent. Callers route embeddings to TEI / OpenAI / Voyage.
- Per-request subprocess spawn adds latency and a concurrency concern (see design grill).

## Alternatives considered

- **OAuth token extraction → direct API calls.** Rejected: explicit ToS violation, active
  enforcement, poor appeal odds.
- **Real Anthropic API key.** The sanctioned path, but defeats the project's purpose (use
  the subscription you already pay for). Kept as the documented safe fallback, not the default.
