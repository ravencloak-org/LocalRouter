#!/usr/bin/env bash
# Wrap the tray executable into a LocalRouter.app bundle (LSUIElement -> menu-bar only).
set -euo pipefail
cd "$(dirname "$0")"

swift build -c release
APP="LocalRouter.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp .build/release/LocalRouterTray "$APP/Contents/MacOS/LocalRouter"
# SwiftPM resource bundle (tray icon) — Bundle.module resolves next to the executable
cp -R .build/release/*.bundle "$APP/Contents/MacOS/" 2>/dev/null || true
# app icon (Finder) from the logo
sips -s format icns ../assets/logo.png --out "$APP/Contents/Resources/icon.icns" >/dev/null 2>&1 || true

# bundle the core binary + built dashboard so "Start Core" works from the .app standalone.
# The tray spawns localrouter-core with cwd = Contents/Resources, so it serves ./web/dist.
# NOT guarded with `|| true`: a coreless/dashboard-less .app is worse than a failed build.
( cd ../web && bun install && bun run build )
( cd ../core && bun build server.ts --compile --outfile "$OLDPWD/$APP/Contents/MacOS/localrouter-core" )
mkdir -p "$APP/Contents/Resources/web"
cp -R ../web/dist "$APP/Contents/Resources/web/dist"
[ -x "$APP/Contents/MacOS/localrouter-core" ] || { echo "error: localrouter-core missing from bundle" >&2; exit 1; }

cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>LocalRouter</string>
  <key>CFBundleIdentifier</key><string>dev.localrouter.tray</string>
  <key>CFBundleExecutable</key><string>LocalRouter</string>
  <key>CFBundleIconFile</key><string>icon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>LSUIElement</key><true/>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
</dict>
</plist>
PLIST

echo "built $APP"
