#!/bin/sh
# Regenerates the addons.mozilla.org screenshots in amo/screenshots/ (1280x800)
# from the real popup and options pages, rendered in headless Firefox with
# fake data (shim.js; all hosts are example.com).
#   npm run screenshots
# FIREFOX overrides the browser binary (defaults to Developer Edition's macOS
# path; on Linux try FIREFOX=firefox-developer-edition).
set -eu
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FIREFOX=${FIREFOX:-"/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"}
OUT="$ROOT/amo/screenshots"
WORK=$(mktemp -d)

cp -R "$ROOT"/extension/. "$WORK"/
cp "$HERE/shim.js" "$HERE/drive.js" "$HERE/stage.js" "$HERE/stage.css" "$WORK"/
# Load the shim before the pages' own scripts; then stage.js (popup frame and
# caption) after popup.js, and the driver after options.js.
sed -i.bak 's#<script src="store.js"></script>#<script src="shim.js"></script>&#' "$WORK/popup.html" "$WORK/options.html"
sed -i.bak 's#<script src="popup.js"></script>#&<script src="stage.js"></script>#' "$WORK/popup.html"
sed -i.bak 's#<script src="options.js"></script>#&<script src="drive.js"></script>#' "$WORK/options.html"
mkdir -p "$OUT"

# shot NAME URL [dark]: one 1280x800 screenshot in a fresh profile.
shot() {
  profile=$(mktemp -d)
  scheme=1
  if [ "${3:-}" = dark ]; then scheme=0; fi
  printf 'user_pref("layout.css.prefers-color-scheme.content-override", %s);\nuser_pref("ui.systemUsesDarkTheme", %s);\n' \
    "$scheme" "$((1 - scheme))" > "$profile/user.js"
  "$FIREFOX" -headless -no-remote -profile "$profile" --window-size 1280,800 \
    --screenshot "$OUT/$1.png" "file://$WORK/$2" > /dev/null 2>&1
  echo "wrote amo/screenshots/$1.png"
}

shot 1-popup-signs-in "popup.html#answer"
shot 2-popup-locked "popup.html#locked"
shot 3-options-logins "options.html#logins"
shot 4-options-edit-and-test "options.html#edit"
shot 5-popup-dark "popup.html#answer" dark
