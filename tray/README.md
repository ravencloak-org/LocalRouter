# LocalRouter Tray (macOS)

Native menu-bar app (`NSStatusItem`). A thin launcher over the core's `/control/*` API
(ADR-0003) — it holds no business logic, just drives the running core.

## Build & run (dev)

```bash
swift build
./.build/debug/LocalRouterTray      # needs the core running: (cd ../core && bun run dev)
```

## Build the .app

```bash
./build-app.sh        # -> LocalRouter.app (LSUIElement: menu-bar only, no Dock icon)
open LocalRouter.app
```

## Menu

- **status line** — running · model · effort · login state (updates every 5s)
- **Login (claude)…** — opens Terminal.app running `claude login` (interactive OAuth)
- **Model** — sonnet / opus / haiku → `POST /control/config`
- **Effort** — low / medium / high → `POST /control/config`
- **Start Core** — spawns the core (`$LR_CORE`, else bundled `localrouter-core`, else `bun $LR_REPO/core/server.ts`)
- **Stop Core** — `POST /control/shutdown` (Start again to restart, e.g. to apply a new port)
- **Open Dashboard** — opens `LR_DASHBOARD`

`build-app.sh` bundles the core binary + built dashboard into the `.app`, so **Start Core**
works standalone (no dev checkout needed).

## Env

- `LR_PORT` (default 8083) — core port
- `LR_DASHBOARD` (default `http://127.0.0.1:5173`) — dashboard URL

## Signing

Unsigned in v0 → Gatekeeper blocks first launch. Right-click → Open once, or notarize for a
clean Homebrew cask install.
