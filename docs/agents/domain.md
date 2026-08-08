# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, or
- **`CONTEXT-MAP.md`** at the repo root if it exists — it points at one `CONTEXT.md` per context. Read each one relevant to the topic.
- **`docs/adr/`** — read ADRs that touch the area you're about to work in. In multi-context repos, also check `src/<context>/docs/adr/` for context-scoped decisions.

If any of these files don't exist, **proceed silently**. Don't flag their absence; don't suggest creating them upfront. The `/domain-modeling` skill (reached via `/grill-with-docs` and `/improve-codebase-architecture`) creates them lazily when terms or decisions actually get resolved.

## File structure

This is a single-context repo — one `CONTEXT.md` + `docs/adr/` at the root:

```
/
├── CONTEXT.md
├── docs/adr/
│   ├── 0001-bun-ts-proxy-ripple-dashboard.md
│   ├── 0002-claude-cli-not-oauth-token.md
│   └── 0003-control-surface-split.md
├── core/          ← Bun/TS Core (OpenAI-compatible API → claude CLI)
└── web/           ← Ripple.js Dashboard
```

The `core` and `web` npm workspaces are one product, not separate contexts — they share the single root `CONTEXT.md`.

## Use the glossary's vocabulary

When your output names a domain concept (in an issue title, a refactor proposal, a hypothesis, a test name), use the term as defined in `CONTEXT.md` — e.g. **Core**, **CLI**, **Dashboard**, **Tray**, **Event Bus** are canonical; don't drift to "server"/"proxy"/"router" in prose.

If the concept you need isn't in the glossary yet, that's a signal — either you're inventing language the project doesn't use (reconsider) or there's a real gap (note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0002 (drive the claude CLI, not the OAuth token) — but worth reopening because…_
