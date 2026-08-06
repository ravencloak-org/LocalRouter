#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# 1. Build the dashboard -> web/dist
cd web && bun install && bun run build
cd "$ROOT"

# 2. Compile the core (bundles web/dist path lookup at runtime, not the files)
cd core && bun build server.ts --compile --define "process.env.LR_VERSION=\"${LR_VERSION:-0.0.0-dev}\"" --outfile "$ROOT/dist/localrouter"
cd "$ROOT"

echo "built: $ROOT/dist/localrouter"
