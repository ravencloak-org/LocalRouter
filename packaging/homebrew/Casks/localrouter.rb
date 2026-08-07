cask "localrouter" do
  # Update `version` and `sha256` on every release.
  # Release automation replaces SHA256_MACOS_ZIP with the real checksum of
  # LocalRouter-macos.zip for the tagged version.
  version "VERSION"
  sha256 "SHA256_MACOS_ZIP"

  url "https://github.com/ravencloak-org/LocalRouter/releases/download/v#{version}/LocalRouter-macos.zip"
  name "LocalRouter"
  desc "Menu-bar app for LocalRouter"
  homepage "https://github.com/ravencloak-org/LocalRouter"

  depends_on macos: :ventura

  app "LocalRouter.app"

  # The app is ad-hoc signed, not notarized. Strip the download quarantine so Gatekeeper
  # lets it launch directly instead of blocking it as an "unidentified developer".
  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-dr", "com.apple.quarantine", "#{appdir}/LocalRouter.app"]
  end

  caveats <<~EOS
    LocalRouter requires the Claude CLI to be installed and logged in:
      https://docs.anthropic.com/en/docs/claude-code

    The menu-bar app installed by this cask is the UI only. The headless
    core runs separately — install it with:
      brew install ravencloak-org/localrouter/localrouter
  EOS
end
