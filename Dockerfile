# LocalRouter as a container: the compiled Bun core + the real `claude` CLI.
#
# Auth is delegated to the CLI (ADR-0002). For a headless container, generate a
# long-lived token on a machine where you're logged in:
#     claude setup-token
# then pass it as CLAUDE_CODE_OAUTH_TOKEN (see docker-compose.yml). No interactive
# login happens inside the container.

# ---- build: dashboard + compiled core (needs Bun) ----
FROM oven/bun:1 AS build
WORKDIR /src
COPY . .
RUN cd web && bun install && bun run build
ARG LR_VERSION=0.0.0-docker
RUN cd core && bun build server.ts --compile \
      --define "process.env.LR_VERSION=\"${LR_VERSION}\"" \
      --outfile /src/localrouter

# ---- runtime: needs Node for the claude CLI; the core binary embeds its own Bun ----
FROM node:22-slim AS runtime
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates git \
 && npm i -g npm@latest \
 && npm i -g @anthropic-ai/claude-code \
 && apt-get purge -y --auto-remove \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/localrouter /app/localrouter
COPY --from=build /src/web/dist    /app/web/dist
# /data holds requests.db, config.json, and the CLI's own state (HOME) so it persists.
# 0.0.0.0 so the mapped port is reachable; the container network is the isolation boundary here.
ENV HOME=/data LR_CONFIG_DIR=/data LR_PORT=8083 LR_HOST=0.0.0.0
RUN mkdir -p /data
VOLUME /data
EXPOSE 8083
CMD ["/app/localrouter"]
