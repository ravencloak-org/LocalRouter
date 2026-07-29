#!/usr/bin/env bash
# Stamp VERSION + real checksums into the Homebrew formula/cask and flake.nix from the
# built release assets. Run after a release build; then commit flake.nix + push the tap.
#
# Usage: scripts/release-fill.sh <version> <artifacts-dir>
#   artifacts-dir must contain:
#     localrouter-darwin-arm64  localrouter-darwin-x64
#     localrouter-linux-x64     localrouter-linux-arm64
#     LocalRouter-macos.zip
set -euo pipefail
VER="${1:?usage: release-fill.sh <version> <artifacts-dir>}"
DIR="${2:?usage: release-fill.sh <version> <artifacts-dir>}"
cd "$(dirname "$0")/.."

hex() { shasum -a 256 "$DIR/$1" | awk '{print $1}'; }                        # brew: hex digest
sri() { printf 'sha256-%s' "$(openssl dgst -sha256 -binary "$DIR/$1" | openssl base64)"; } # nix: SRI

DA=$(hex localrouter-darwin-arm64);  DX=$(hex localrouter-darwin-x64)
LX=$(hex localrouter-linux-x64);     LA=$(hex localrouter-linux-arm64)
ZIP=$(hex LocalRouter-macos.zip)
SDA=$(sri localrouter-darwin-arm64); SDX=$(sri localrouter-darwin-x64)
SLX=$(sri localrouter-linux-x64);    SLA=$(sri localrouter-linux-arm64)

F=packaging/homebrew/Formula/localrouter.rb
C=packaging/homebrew/Casks/localrouter.rb
N=flake.nix

# perl -pi is portable across BSD (macOS) and GNU (CI) sed differences.
perl -pi -e "s/VERSION/$VER/g; s/SHA256_DARWIN_ARM64/$DA/; s/SHA256_DARWIN_X64/$DX/; s/SHA256_LINUX_X64/$LX/; s/SHA256_LINUX_ARM64/$LA/;" "$F"
perl -pi -e "s/VERSION/$VER/g; s/SHA256_MACOS_ZIP/$ZIP/;" "$C"
perl -pi -e "s/version = \"0.0.0\"/version = \"$VER\"/;" "$N"
perl -pi -e "s{sha256-A{43}=}{$SLX}; s{sha256-B{43}=}{$SLA}; s{sha256-C{43}=}{$SDA}; s{sha256-D{43}=}{$SDX};" "$N"

echo "Filled v$VER into:"
echo "  $F  $C  $N"
echo "Next: commit flake.nix, and copy Formula/ + Casks/ to the ravencloak-org/homebrew-localrouter tap."
