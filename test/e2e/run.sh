#!/bin/sh
# End-to-end test in headless Firefox Developer Edition: copies the extension,
# appends background-steps.js, adds the e2e page, and reports each step.
#   test/e2e/run.sh
# Override the browser with FIREFOX=/path/to/firefox.
set -u
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
FIREFOX=${FIREFOX:-"/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox"}
WORK=$(mktemp -d)
EXT="$WORK/ext"
LOG="$WORK/firefox.log"

mkdir -p "$EXT"
cp "$ROOT"/extension/* "$EXT"/
cat "$HERE/background-steps.js" >> "$EXT/background.js"
cp "$HERE/page.js" "$EXT/e2e-page.js"
printf '<!doctype html><meta charset="utf-8"><script src="store.js"></script><script src="e2e-page.js"></script>\n' > "$EXT/e2e-page.html"

node "$ROOT/test/server.js" > /dev/null &
SERVER=$!
npx -y web-ext@8 run --verbose -s "$EXT" --firefox="$FIREFOX" --arg=-headless \
  --pref=browser.dom.window.dump.enabled=true --no-reload > "$LOG" 2>&1 &
RUNNER=$!

i=0
while [ $i -lt 90 ] && ! grep -q "E2E DONE" "$LOG"; do
  sleep 1
  i=$((i + 1))
done
kill $RUNNER $SERVER 2> /dev/null
pkill -f "web-ext@8 run" 2> /dev/null

if ! grep -q "E2E DONE" "$LOG"; then
  echo "Timed out; Firefox log: $LOG"
  exit 1
fi
grep -oE "E2E [a-z-]+ (PASS|FAIL).*" "$LOG"
if grep -q "E2E [a-z-]* FAIL" "$LOG"; then exit 1; fi
echo "All e2e steps passed."
