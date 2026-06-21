#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CALLER_DIR="$PWD"
PROJECT_DIR="${PROMPT_CANVAS_PROJECT_DIR:-${1:-$CALLER_DIR}}"
CANVAS_DIR="${PROMPT_CANVAS_CANVAS_DIR:-$PROJECT_DIR/canvas}"
BASE_URL="${PROMPT_CANVAS_BASE_URL:-http://127.0.0.1:47321}"

export PROMPT_CANVAS_PROJECT_DIR="$PROJECT_DIR"
export PROMPT_CANVAS_CANVAS_DIR="$CANVAS_DIR"
export PROMPT_CANVAS_BASE_URL="$BASE_URL"

cd "$ROOT_DIR"
exec python3 mcp-server/prompt_canvas_mcp.py
