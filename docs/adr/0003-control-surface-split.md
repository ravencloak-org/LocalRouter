# 3. Control-surface split: dashboard universal, native tray per-OS

Date: 2026-07-29

## Status

Accepted

## Context

We want a status-bar/menu-bar app to control LocalRouter (Login, model selector, effort
level, open dashboard, stop) and we want it "native on macOS, Linux, BSD, and Windows."

Hard constraints surfaced during design:

- **Swift has no cross-platform system tray.** Tray APIs are OS-specific (macOS AppKit
  `NSStatusItem`, Windows Win32 `Shell_NotifyIcon`, Linux DBus `StatusNotifierItem`). Swift
  compiles on Linux/Windows but has no tray binding there.
- **No toolkit supports a BSD tray.** Go systray, Rust tray-icon, and Tauri all cover
  mac/win/linux only. BSD desktop tray is an unsupported edge case.
- The **web dashboard already runs on all four OSes** in any browser.

So "native tray everywhere in Swift" is not achievable, and native trays everywhere at all
would be 3 codebases (Swift + Win32 + DBus) with BSD still unsolved.

## Decision

Split the control surface:

- **Universal control = the web dashboard.** It is the cross-platform UI (all 4 OSes). It
  hosts every control: Login trigger, model selector, effort (low/medium/high) selector,
  Stop, and live status. This is how Linux/BSD/Windows get full control with zero per-OS
  tray code.
- **Core exposes localhost-only `/control/*` endpoints** backed by a shared config file
  `~/.config/localrouter/config.json` (`{model, effort, port}`), read live per request. Tray,
  dashboard, and CLI all read/write the same file.
- **Native tray = a thin per-OS launcher on top:**
  - **macOS now: Swift `NSStatusItem`** (thin — shells `claude login`, `open`, writes config).
  - **Windows/Linux later: Go systray** (one small cross-platform codebase) — NOT Swift.
  - **BSD: dashboard-only** (no toolkit supports its tray).

## Consequences

- Full control on all four OSes via the dashboard; no tray sprawl.
- Swift stays where it is genuinely native (macOS). We never write three tray codebases.
- The tray is optional convenience, not the only interface — matches ADR-0001 (dashboard is
  the interface).
- `/control/*` is powerful (spawns `claude login`, can shut the core down), so it MUST bind
  `127.0.0.1` and require a non-simple header (`X-LocalRouter`) to defeat drive-by CSRF from
  arbitrary web pages. A real per-boot token is a hardening follow-up.
- Interactive `claude login` needs a TTY/browser. The macOS tray opens Terminal.app running
  `claude login`; a dashboard-triggered login on a headless host may require the user to run
  it in a terminal. Documented, not hidden.

## Alternatives considered

- **Native trays everywhere (Swift + Win32 + DBus).** Rejected: ~3 tray codebases, and BSD
  still has no native tray. Effort/coverage both bad.
- **One cross-platform toolkit (Go systray / Rust tray-icon / Tauri), drop Swift.** Real
  option — one native tray codebase for mac/win/linux. Kept as the path if native win/linux
  trays become a v1 requirement. Rejected for now because the dashboard already covers
  win/linux/bsd and macOS is better served by native Swift.
