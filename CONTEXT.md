# LocalRouter — Context (Glossary)

Canonical terms for LocalRouter. Glossary only - no implementation details, no decisions
(those live in `docs/adr/`).

## Core
The backend process. Accepts OpenAI-compatible HTTP requests and routes chat calls to the
`claude` CLI. Owns the Event Bus and serves both the API and the Dashboard's feed.
Not "server", not "proxy", not "router" in prose - "Core".

## CLI
The genuine `claude` binary (Claude Code), spawned by the Core as a subprocess. It
self-authenticates against the user's Claude subscription. The Core never handles its
credentials. Say "the CLI", not "Claude" or "the API" - LocalRouter never touches the
Anthropic API.

## Dashboard
The Ripple.js web UI. The single human surface. Consumes the Event feed and displays
Requests, logs, Spans, and Core status. There is no TUI.

## Request
One OpenAI-compatible `/v1/chat/completions` call as seen by the Core: its inbound payload,
the resulting CLI invocation, and the outbound OpenAI-shaped response. The unit the
Dashboard inspects.

## Event
An item on the Event Bus, emitted by the Core and streamed to the Dashboard over SSE. Three
kinds: log line, Request summary, and Span. The Dashboard renders the Event feed; it does
not read Core internals.

## Span
An OpenTelemetry span for one Request (e.g. CLI spawn latency, token counts). A kind of
Event. "Span" always means the OTel sense here, never a UI element.

## Embedding (excluded)
LocalRouter does **not** serve embeddings - the CLI has none. Named here only to fix the
boundary: an embedding request is out of scope and rejected, never routed.
