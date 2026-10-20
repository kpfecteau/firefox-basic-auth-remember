#!/bin/sh
# End-to-end test in headless Firefox Developer Edition: copies the extension,
# appends background-steps.js, adds the e2e pages (page.js, and the options
# page driven by options-steps.js), and reports each step.
#   test/e2e/run.sh
# FIREFOX defaults to web-ext's "firefoxdeveloperedition" alias, which finds
# Developer Edition's default install on macOS, Linux and Windows; set
# FIREFOX=/path/to/firefox to use another binary. On Windows, run this under
# WSL: Git Bash lacks pkill, so Firefox may be left running after the run.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FIREFOX=${FIREFOX:-firefoxdeveloperedition}
WORK=$(mktemp -d)
EXT="$WORK/ext"
LOG="$WORK/firefox.log"

mkdir -p "$EXT"
cp "$ROOT"/extension/* "$EXT"/
cat "$HERE/background-steps.js" >> "$EXT/background.js"
cp "$HERE/page.js" "$EXT/e2e-page.js"
printf '<!doctype html><meta charset="utf-8"><script src="store.js"></script><script src="e2e-page.js"></script>\n' > "$EXT/e2e-page.html"
# The real options page plus options-steps.js, which drives it.
cp "$HERE/options-steps.js" "$EXT/e2e-options-steps.js"
sed 's#<script src="options.js"></script>#&<script src="e2e-options-steps.js"></script>#' \
  "$ROOT/extension/options.html" > "$EXT/e2e-options.html"
grep -q e2e-options-steps.js "$EXT/e2e-options.html" || { echo "Couldn't inject options steps"; exit 1; }

node "$ROOT/test/server.js" > /dev/null &
SERVER=$!
npx -y web-ext@8 run --verbose -s "$EXT" --firefox="$FIREFOX" --arg=-headless \
  --pref=browser.dom.window.dump.enabled=true --no-reload > "$LOG" 2>&1 &
RUNNER=$!

i=0
while [ $i -lt 240 ] && ! grep -q "E2E DONE" "$LOG"; do
  sleep 1
  i=$((i + 1))
done
kill $RUNNER $SERVER 2> /dev/null
# web-ext runs under npx, so killing $RUNNER can leave web-ext (and its
# Firefox) behind; stop it by name where pkill exists.
if command -v pkill > /dev/null; then pkill -f "web-ext@8 run" 2> /dev/null; fi

if ! grep -q "E2E DONE" "$LOG"; then
  grep -oE "E2E [a-z-]+ (PASS|FAIL).*" "$LOG"
  echo "Timed out after the steps above; Firefox log: $LOG"
  exit 1
fi
grep -oE "E2E [a-z-]+ (PASS|FAIL).*" "$LOG"
if grep -q "E2E [a-z-]* FAIL" "$LOG"; then exit 1; fi
echo "All e2e steps passed."
