#!/usr/bin/env bash
# Wrap the tray executable into a LocalRouter.app bundle (LSUIElement -> menu-bar only).
set -euo pipefail
cd "$(dirname "$0")"

# Real version (for the in-app updater's compare). CI passes the tag; local builds get a dev marker.
VERSION="${LR_VERSION:-${1:-0.0.0-dev}}"

swift build -c release
APP="LocalRouter.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/LocalRouterTray "$APP/Contents/MacOS/LocalRouter"
# Tray icon into Contents/Resources so the .app codesigns as one sealed bundle
# (the SwiftPM *.bundle resolves to the app root, which can't be sealed -> "damaged").
cp Sources/LocalRouterTray/Resources/tray.png "$APP/Contents/Resources/tray.png"
# app icon (Finder) from the logo
sips -s format icns ../assets/logo.png --out "$APP/Contents/Resources/icon.icns" >/dev/null 2>&1 || true

# bundle the core binary + built dashboard so "Start Core" works from the .app standalone.
# The tray spawns localrouter-core with cwd = Contents/Resources, so it serves ./web/dist.
# NOT guarded with `|| true`: a coreless/dashboard-less .app is worse than a failed build.
( cd ../web && bun install && bun run build )
( cd ../core && bun build server.ts --compile --define "process.env.LR_VERSION=\"${VERSION#v}\"" --outfile "$OLDPWD/$APP/Contents/MacOS/localrouter-core" )
mkdir -p "$APP/Contents/Resources/web"
cp -R ../web/dist "$APP/Contents/Resources/web/dist"
[ -x "$APP/Contents/MacOS/localrouter-core" ] || { echo "error: localrouter-core missing from bundle" >&2; exit 1; }

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>LocalRouter</string>
  <key>CFBundleIdentifier</key><string>dev.localrouter.tray</string>
  <key>CFBundleExecutable</key><string>LocalRouter</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION#v}</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
PLIST

# Ad-hoc codesign the whole bundle. Everything now lives under Contents/, so the seal is
# valid and macOS no longer flags the app as "damaged" (the cask postflight strips quarantine).
codesign --force --deep --sign - "$APP"
codesign --verify --verbose "$APP"

echo "built $APP"
