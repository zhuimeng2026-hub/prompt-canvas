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

PROJECT_DIR="${PROMPT_CANVAS_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${PROMPT_CANVAS_CANVAS_DIR:-$PROJECT_DIR/canvas}"
PORT="${PROMPT_CANVAS_PORT:-52846}"
HOST="${PROMPT_CANVAS_HOST:-127.0.0.1}"
BASE_URL="${PROMPT_CANVAS_BASE_URL:-http://${HOST}:${PORT}}"

export PROMPT_CANVAS_PROJECT_DIR="$PROJECT_DIR"
export PROMPT_CANVAS_CANVAS_DIR="$CANVAS_DIR"
export PROMPT_CANVAS_PORT="$PORT"
export PROMPT_CANVAS_HOST="$HOST"
export PROMPT_CANVAS_BASE_URL="$BASE_URL"

cd "$ROOT_DIR"
exec python3 mcp-server/prompt_canvas_mcp.py
