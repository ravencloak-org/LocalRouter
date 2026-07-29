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
