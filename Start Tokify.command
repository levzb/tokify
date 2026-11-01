#!/bin/zsh
# Finder starts with a small PATH; include the usual Homebrew locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install it once before using Tokify offline."
  read "?Press Enter to close."
  exit 1
fi
node scripts/offline.mjs
result=$?
if (( result != 0 )); then
  read "?Tokify could not start. Press Enter to close."
fi
exit $result
