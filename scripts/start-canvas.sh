#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"

# Load .env if present, otherwise fall back to .env.example.
# Existing environment variables always take precedence.
_load_env() {
  local file="$1"
  [ -f "$file" ] || return
  while IFS='=' read -r key value || [ -n "$key" ]; do
    [ -z "$key" ] && continue
    [[ "$key" =~ ^[[:space:]]*# ]] && continue
    key="$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="$(echo "$value" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    [ -z "${!key+x}" ] && export "$key=$value"
  done < "$file"
}
_load_env "$ROOT_DIR/.env"
_load_env "$ROOT_DIR/.env.example"

PORT="${PROMPT_CANVAS_PORT:-52846}"
HOST="${PROMPT_CANVAS_HOST:-127.0.0.1}"
PROJECT_DIR="${PROMPT_CANVAS_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${PROMPT_CANVAS_CANVAS_DIR:-$PROJECT_DIR/canvas}"

export PROMPT_CANVAS_PROJECT_DIR="$PROJECT_DIR"
export PROMPT_CANVAS_CANVAS_DIR="$CANVAS_DIR"
export PROMPT_CANVAS_PORT="$PORT"
export PROMPT_CANVAS_HOST="$HOST"

cd "$ROOT_DIR"

if [ ! -d node_modules ] || [ ! -x node_modules/.bin/vite ]; then
  npm install
fi

npm run build

echo "Prompt Canvas: http://${HOST}:${PORT}/"
echo "Prompt Canvas data: ${CANVAS_DIR}/pages/<page>/prompt-canvas.json"
echo "Prompt Canvas assets: ${CANVAS_DIR}/pages/<page>/assets/ -> http://${HOST}:${PORT}/page-assets/<page>/"
exec python3 server.py
