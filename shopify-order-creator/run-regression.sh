#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TS_DIR="$SCRIPT_DIR/ts"

cd "$TS_DIR"
if [[ ! -d node_modules ]]; then
  echo "Installing dependencies..."
  npm install
fi
npm run build >/dev/null 2>&1 || true
exec npx --no-install qa-order-tool-ts "$@"
