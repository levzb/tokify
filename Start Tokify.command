#!/bin/zsh
# macOS: double-click to open Tokify. The first run installs everything (npm run setup).
# Finder starts with a small PATH; include the usual Homebrew locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22.13 or newer is required: https://nodejs.org"
  read "?Press Enter to close."
  exit 1
fi
if [[ -d node_modules && -f dist/index.html ]]; then npm start; else npm run setup; fi
result=$?
if (( result != 0 )); then
  read "?Tokify could not start. Press Enter to close."
fi
exit $result
