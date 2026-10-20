#!/bin/sh
# Packages the extension as an unsigned .xpi for permanent install in
# Firefox Developer Edition (requires xpinstall.signatures.required = false).
# Uses web-ext so it works the same on macOS, Linux and Windows; on Windows,
# run `npm run build` (or the npx command below) instead of this script.
set -e
cd "$(dirname "$0")"
npx -y web-ext@8 build -s extension -a . -n basic-auth-remember.xpi --overwrite-dest
