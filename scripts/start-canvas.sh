#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
PORT="${PROMPT_CANVAS_PORT:-47321}"
PROJECT_DIR="${PROMPT_CANVAS_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${PROMPT_CANVAS_CANVAS_DIR:-$PROJECT_DIR/canvas}"

export PROMPT_CANVAS_PROJECT_DIR="$PROJECT_DIR"
export PROMPT_CANVAS_CANVAS_DIR="$CANVAS_DIR"
export PROMPT_CANVAS_PORT="$PORT"

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/vite ]; then
  npm install
fi

npm run build

echo "Prompt Canvas: http://127.0.0.1:${PORT}/"
echo "Prompt Canvas data: ${CANVAS_DIR}/pages/<page>/prompt-canvas.json"
echo "Prompt Canvas assets: ${CANVAS_DIR}/pages/<page>/assets/ -> http://127.0.0.1:${PORT}/page-assets/<page>/"
exec python3 server.py
