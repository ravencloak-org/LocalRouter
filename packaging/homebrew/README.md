# Homebrew packaging

LocalRouter ships two Homebrew artifacts:

- **Cask** (`Casks/localrouter.rb`) — the macOS menu-bar app (`LocalRouter.app`), from `LocalRouter-macos.zip`.
- **Formula** (`Formula/localrouter.rb`) — the headless core binary (`localrouter`), for macOS and Linux, arm64 + x64.

These live in a separate tap repo: **`ravencloak-org/homebrew-localrouter`**. Copy the `Casks/` and `Formula/` dirs there (Homebrew requires the `homebrew-` prefix on the repo name; the tap is referenced without it).

## Install

```sh
brew tap ravencloak-org/localrouter
```

Menu-bar app (macOS only):

```sh
brew install --cask localrouter
```

Headless core (macOS or Linux):

```sh
brew install localrouter
```

You can install both — the app is the UI, the formula is the core, and they run separately.

## Requirements

Both require the [`claude` CLI](https://docs.anthropic.com/en/docs/claude-code) installed and logged in.

## Releases

`version` and the `sha256` placeholders (`VERSION`, `SHA256_*`) in both files are filled in by release automation for each `vX.Y.Z` tag, then pushed to the tap repo. Do not hand-edit checksums.
