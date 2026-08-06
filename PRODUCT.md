# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing repo: Bun runtime + Hono (core proxy / `/control` API), Vite + Ripple.js (the dashboard under `web/`), Swift menu-bar app (`tray/`), Go tray for Windows/Linux (`tray-go/`). The **public stats website** is a new surface built with **Astro** (chosen for SEO, zero-JS static perf, islands for live stat counters, and marketing-native content — over reusing the alpha Ripple SPA). Lives in `site/`; pulls aggregate numbers from the self-hosted Aptabase.

## Users

Primary (for the stats site): **a developer discovering LocalRouter and deciding whether to install/self-host it.** They arrive skeptical, want quick proof it works, that it is safe enough to run, and that it is worth it (real cost saved, real usage).

Secondary (for the existing dashboard): **a current self-hoster** monitoring their own router — requests, queue, cost saved, login/health.

## Product Purpose

LocalRouter is an OpenAI-compatible HTTP proxy that routes chat calls to the real `claude` CLI, so any OpenAI-compatible tool (Continue.dev, litellm, LangChain, or a custom client) can use a Claude Max/Pro **subscription** instead of a metered API key. Success: a developer points an existing OpenAI client at `http://localhost:8083/v1` with no client changes and gets Claude responses billed against their subscription, with visibility into what it saved.

## Positioning

The defensible mechanism a metered-API competitor cannot truthfully copy:

- **Drives the genuine `claude` CLI, never the token.** The CLI self-authenticates; LocalRouter never extracts or touches the OAuth token. Extracting subscription tokens for third-party clients is banned by Anthropic; calling the real CLI is allowed. (ADR-0002.)
- **Context isolation.** Strips Claude Code's agent context per call — measured ~161K → ~183 tokens, ~$0.92 → ~$0.0006 per request — while keeping OAuth intact.
- **Local, single-user.** Binds `127.0.0.1` only.

The honest tradeoff (ToS-adjacent, burns Claude Code usage quota, not flat-rate, local single-user) is a **binding product fact**: keep the disclosure clear and findable, but the site **leads with value** (subscription reuse, cost saved) and keeps the disclosure secondary — not hidden, not the headline.

## Operating Context

- Runs locally; requires the `claude` CLI installed and logged in (`claude login`) as a runtime dependency LocalRouter drives, not bundles.
- Distributed via GitHub Releases, a Homebrew tap (formula + cask), and a Nix flake. Menu-bar app (macOS) and tray (Windows/Linux) self-update from GitHub releases.
- The stats site is fed by **anonymous, opt-out telemetry** to a self-hosted Aptabase instance (`aptabase.jobin.wtf`): aggregate installs, tokens served, and dollars saved.

## Capabilities and Constraints

- OpenAI-compatible endpoints: `/v1/chat/completions` (stream + non-stream), `/v1/models` (advertises `sonnet`/`opus`/`haiku`), `/v1/embeddings` (liveness echo).
- Bounded concurrency (default 8 CLI subprocesses), request queue with honest phase states, error taxonomy, SSE event feed, `/healthz`, SQLite request log.
- Live Ripple.js dashboard: requests, logs, queue phases, cost, and client-token (auth) management.
- Model and effort (low/medium/high) are per-request CLI flags driven live from a config file — changes apply on the next request without restarting the process.
- Telemetry sends only `model` + token counts + `usd_saved`; never prompts, responses, client tokens, or IPs. Off via `DO_NOT_TRACK=1` or `LR_TELEMETRY=0`.
- Constraints: ToS-adjacent; consumes Claude Code usage quota (not flat-rate); local single-user only.

## Brand Commitments

- Name: **LocalRouter**. Org: `ravencloak-org`.
- Icon: a **moose-mask** mark — flat, geometric, maroon / orange / coral-red — used across the dashboard favicon, both tray apps, and the README header.
- Voice: technical, candid, direct. The README states the tradeoff plainly ("This is ToS-adjacent and not flat-rate"); that candor is part of the brand.
- Honest positioning (above) is binding: never reframe the product as flat-rate, officially sanctioned, or token-extracting.

## Evidence on Hand

- Working product shipped at **v0.1.6**: core + dashboard (`localhost:8083`), cross-platform binaries, mac app, win/linux tray bundles.
- Live metrics pipeline: self-hosted Aptabase at `aptabase.jobin.wtf` collecting `model` / `tokens` / `usd_saved`.
- Docs: `README.md`, `DEPLOY.md`, `docs/adr/0002-claude-cli-not-oauth-token.md`, ADR-0003 (control-surface split), `PLAN.md`.
- **No** testimonials, customer names, adoption counts, or savings figures beyond the two measured isolation numbers (161K→183 tokens, $0.92→$0.0006). Future work must not fabricate these — real aggregate numbers come only from Aptabase.

## Product Principles

1. **Honesty wins the skeptic.** The audience is skeptical developers; candor about the tradeoff is the trust signal, not a liability to bury.
2. **Never touch the token.** The product's legitimacy rests entirely on driving the real CLI and never extracting OAuth — preserve this framing everywhere.
3. **Local and private by default.** Binds localhost; telemetry is anonymous and opt-out. Privacy is a feature, not a footnote.
4. **Real numbers only.** Every advertised stat (installs, tokens served, $ saved) traces to actual telemetry. No invented adoption or savings.
5. **Agnostic of downstream apps.** LocalRouter serves any OpenAI-compatible client; specific integrations (e.g. Cognee) are example use cases in docs, never dependencies or requirements.

## Accessibility & Inclusion

Public marketing surface: hold to standard WCAG AA (contrast, keyboard, reduced-motion). No product-specific accessibility requirement was established beyond that.
