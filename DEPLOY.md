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

1. [x] `bun build --compile` core (`scripts/build.sh`) + serves dashboard at `/` (SPA fallback). Core-compile verified.
2. [x] Dashboard control UI (Login / model / effort / stop / status) — `web/src/control.ts` + `App.ripple`. Ripple alpha: syntax not vite-verified.
3. [x] GitHub Actions release workflow — `.github/workflows/release.yml` (bun cross-compile matrix on ubuntu + macOS .app job).
4. [x] Swift `LocalRouter.app` (macOS menu bar) — `tray/`, `build-app.sh`.
5. [x] Homebrew tap (cask + formula) — `packaging/homebrew/`.
6. [x] Nix flake (core binary + NixOS module) — `flake.nix`.
7. [ ] Go systray (win/linux) — optional, later.

## Asset naming (canonical — CI, brew, nix all agree)

- Core binaries: `localrouter-<os>-<arch>` with `os ∈ {darwin, linux, windows}` (windows `.exe`).
- macOS app: `LocalRouter-macos.zip` (contains `LocalRouter.app`).
- `VERSION` + `sha256`/SRI hashes in the brew formula/cask and flake are placeholders that
  release automation fills per tag.

## Known gotchas (from integration)

- **Static root is cwd-relative.** The compiled core serves `./web/dist` — run it from a dir
  that contains `web/dist`, or it shows the "not built" fallback. Packaging must co-locate them
  (or embed the dashboard later).
- **Dashboard is Ripple alpha, not vite-verified.** `bun run build` in `web/` may need syntax
  fixes (`@for` vs `for`, `track<T>()` generic). Flagged `// ponytail:` in `App.ripple`.
- Core `--version` prints `localrouter <VERSION>` and exits (brew/nix test hook).

## Notes

- Core binds `127.0.0.1` only. `/control/*` requires the `X-LocalRouter` header (CSRF guard).
- BSD: headless core + dashboard only (no native tray toolkit supports BSD).
- `claude` CLI is a runtime dependency the user installs + logs into separately; LocalRouter
  drives it, does not bundle it.
