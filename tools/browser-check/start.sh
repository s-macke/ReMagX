#!/usr/bin/env bash
# Serves app/dist on http://localhost:8765 and starts headless Chrome with remote debugging on
# port 9333. Build first: (cd app && npm run build). Stop with ./stop.sh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dist="$here/../../app/dist"
profile="$(mktemp -d)"
(cd "$dist" && python3 -m http.server 8765 >/dev/null 2>&1 &)
sleep 1
chrome="${CHROME:-$(command -v google-chrome || command -v chromium || command -v chromium-browser)}"
("$chrome" --headless=new --disable-gpu --no-sandbox --remote-debugging-port=9333 --user-data-dir="$profile" http://localhost:8765/ >/dev/null 2>&1 &)
sleep 2
echo "app on http://localhost:8765, DevTools on port 9333"
