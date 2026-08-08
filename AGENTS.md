# AGENTS.md

Guidance for AI agents working in this repo. See `CONTEXT.md` for the domain glossary and `docs/adr/` for architecture decisions.

## Agent skills

### Issue tracker

Issues and specs live in this repo's **GitHub Issues** (`ravencloak-org/LocalRouter`), driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical triage roles use their default label strings (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one root `CONTEXT.md` + `docs/adr/`. Read them before exploring; use the glossary's vocabulary. See `docs/agents/domain.md`.
