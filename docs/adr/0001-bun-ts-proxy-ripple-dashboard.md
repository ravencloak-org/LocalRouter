# 1. Bun/TS proxy + Ripple dashboard, SSE feed, no TUI

Date: 2026-07-29

## Status

Accepted

## Context

LocalRouter exposes an OpenAI-compatible HTTP API and routes chat calls to the real
`claude` CLI as a subprocess, so OpenAI-format tools (Cognee) can use a Claude Max/Pro
subscription. The subprocess path is deliberate: Anthropic (Jan 2026) bans extracting
subscription OAuth tokens for third-party API clients, but calling the genuine `claude`
CLI is allowed. See [0002](0002-claude-cli-not-oauth-token.md).

Two UI surfaces were considered: a terminal UI (TUI) and a web dashboard. The web
dashboard is mandated in Ripple.js. Both would consume the same event feed (requests,
logs, OTel spans), so a TUI would be a second renderer of one feed - maintained twice
for no new capability.

Backend language was open ("can be anything - it just routes to the CLI"). The only hard
constraint is the mandated Ripple.js frontend, which is TypeScript + Vite.

## Decision

- **No TUI.** Single UI surface: the Ripple web dashboard. YAGNI.
- **Backend: Bun + TypeScript** (Hono for routing). One `bun install` serves both the
  Ripple Vite build and the live feed. Shared event types with the frontend, one
  toolchain, ~80-line core.
- **CLI bridge:** `Bun.spawn(["claude","-p","--output-format","stream-json", ...])`.
- **Live transport: SSE** (server → dashboard). One-way feed of logs / request summaries
  / spans. No WebSocket (no bidirectional need in v0).
- **Observability: OpenTelemetry JS SDK**, one span per proxied request, emitted into the
  in-process event bus.
- **Custom thin backend, not a fork** of an existing proxy (e.g. wende/claude-max-api-proxy).
  The project's point is observability hooks; owning an ~80-line server is cheaper to
  instrument than bending someone else's minimal code.

## Consequences

- One language, one toolchain, shared types end to end. Fast iteration.
- Bun's OTel support has known gaps vs Node. Mitigation: the backend stays plain TS, so
  swapping the runtime to Node (keeping types and code) is trivial if OTel misbehaves.
- No distributable single binary (Go's edge) - acceptable; LocalRouter runs locally beside
  Cognee, not shipped.
- Dropping the TUI means terminal-only users have no LocalRouter UI. Acceptable: the tool
  is a local daemon, the dashboard is the interface.

## Alternatives considered

- **Go core + Bubbletea TUI + Ripple web.** Bubbletea is the best-in-class TUI and Go has
  stronger OTel and a single static binary. Rejected once the TUI was dropped - Bubbletea
  was the sole reason to pay the two-language cost, and the web dashboard consumes an event
  feed (not core types), so shared-type benefits were small either way.
- **Bun/TS core + Ink TUI + Ripple web.** Ink is a strong TS TUI. Rejected with the TUI.
- **Fork wende/claude-max-api-proxy.** Rejected: instrumenting a minimal third-party proxy
  for full observability is more work than a clean owned core.
