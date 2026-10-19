#!/bin/sh
# Packages the extension as an unsigned .xpi for permanent install in
# Firefox Developer Edition (requires xpinstall.signatures.required = false).
set -e
cd "$(dirname "$0")/extension"
rm -f ../basic-auth-remember.xpi
zip -qr ../basic-auth-remember.xpi . -x '.*'
echo "Built $(cd .. && pwd)/basic-auth-remember.xpi"
