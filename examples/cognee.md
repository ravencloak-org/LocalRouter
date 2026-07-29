# Example: Cognee on LocalRouter

[Cognee](https://github.com/topoteretes/cognee) is a memory/RAG framework that talks to an
OpenAI-compatible API via litellm. It needs **two** model roles — an LLM (chat) and an
embedder. LocalRouter serves the LLM through your Claude subscription; embeddings go
elsewhere (the `claude` CLI has none — see the [no-embeddings note](../README.md#use-it-from-any-openai-client)).

## Split the roles

```bash
# LLM -> LocalRouter (Claude subscription via the CLI)
LLM_PROVIDER=custom
LLM_MODEL=openai/claude
LLM_ENDPOINT=http://localhost:8083/v1
LLM_API_KEY=dummy                 # ignored; the CLI holds the real auth

# Embeddings -> a real embeddings provider (NOT LocalRouter)
EMBEDDING_PROVIDER=custom
EMBEDDING_MODEL=openai/nomic-embed-text
EMBEDDING_ENDPOINT=http://localhost:8080/v1   # e.g. a local TEI server
EMBEDDING_API_KEY=dummy
EMBEDDING_DIMENSIONS=768
```

## Why the split

- LocalRouter routes only chat completions to the `claude` CLI. Point `EMBEDDING_*` at it and
  the `/v1/embeddings` 400 surfaces as a hard error (by design — a loud misroute beats a silent one).
- Run LocalRouter with isolation on (the default) so Cognee's bulk indexing is affordable:
  ~183 tokens/call instead of a full agent context. See the main README.

## Watch it

Open the dashboard (`bun run web`) while Cognee indexes — every LLM call shows up as a
Request with latency, tokens, and cost.
