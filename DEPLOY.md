# LocalRouter — Distribution & Deploy (epic)

How LocalRouter ships. See ADR-0003 for the control-surface split.

## Artifacts

| Artifact | What | Platforms |
|---|---|---|
| `localrouter` core | `bun build --compile` single binary (proxy + control API + serves dashboard) | mac, linux, windows, (bsd best-effort) |
| dashboard | static Vite/Ripple build, served by the core at `/` | all (browser) |
| `LocalRouter.app` | Swift `NSStatusItem` menu-bar app, bundles/launches the core | macOS only |
| Go tray (later) | systray launcher | win, linux |

## Channels

### GitHub Releases (source of truth)
Tag `vX.Y.Z` → GitHub Actions matrix:
- build core binary per OS/arch (`bun build --compile --target=bun-{os}-{arch}`)
- build dashboard static bundle
- build + zip `LocalRouter.app` (macOS runner)
- attach all to the Release.

### Homebrew (macOS + Linux CLI)
Tap: `jobinlawrance/localrouter`.
- **cask** `localrouter` → the macOS `.app` (menu bar). Unsigned v0 → Gatekeeper prompt
  (right-click Open) or notarize later ($99 Apple dev).
- **formula** `localrouter` → the headless core binary (for CLI/server users, mac + linux).

### Nix (linux/server + mac CLI)
Flake exposes the **headless core** + dashboard:
- `packages.<system>.localrouter` — the core binary.
- `apps.<system>.default` — `nix run` the core.
- optional `nixosModules.localrouter` — a systemd user service.
- The macOS `.app` bundle is out of nix scope (awkward under nix-darwin); use brew cask there.

## Build order (tasks)

1. [ ] `bun build --compile` the core; have it serve the static dashboard at `/`.
2. [ ] Dashboard control UI (Login / model / effort / stop / status) — universal, all OSes.
3. [ ] GitHub Actions release workflow (core matrix + dashboard + .app).
4. [ ] Swift `LocalRouter.app` (macOS menu bar).
5. [ ] Homebrew tap (cask + formula).
6. [ ] Nix flake (core + dashboard, optional NixOS module).
7. [ ] Go systray (win/linux) — optional, later.

## Notes

- Core binds `127.0.0.1` only. `/control/*` requires the `X-LocalRouter` header (CSRF guard).
- BSD: headless core + dashboard only (no native tray toolkit supports BSD).
- `claude` CLI is a runtime dependency the user installs + logs into separately; LocalRouter
  drives it, does not bundle it.
