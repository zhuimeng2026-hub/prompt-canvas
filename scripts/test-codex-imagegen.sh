#!/usr/bin/env bash
# test-codex-imagegen.sh — Codex + Prompt Canvas 集成测试脚本
# 由 cron 在指定时间执行，验证 Codex 能否通过 Prompt Canvas 生成图片
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
LOG_FILE="$LOG_DIR/codex-test-${TIMESTAMP}.log"

mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOG_FILE"; }
fail() { log "FAIL: $*"; exit 1; }
pass() { log "PASS: $*"; }

# --- 环境准备 ---
log "========== Codex + Prompt Canvas 集成测试 =========="
log "日志文件: $LOG_FILE"

# 加载环境变量
for envfile in "$PROJECT_DIR/.env" "$PROJECT_DIR/.env.example"; do
  if [[ -f "$envfile" ]]; then
    set -a; source "$envfile"; set +a
    log "加载环境: $envfile"
    break
  fi
done

# OPENAI_API_KEY 需要已存在于环境中（来自 shell profile）
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  fail "OPENAI_API_KEY 未设置"
fi
pass "OPENAI_API_KEY 已设置"

# --- Step 1: 重启 codex-proxy ---
log "--- Step 1: 重启 codex-proxy ---"
pkill -f "node.*proxy.mjs" 2>/dev/null || true
sleep 1

PROXY_DIR="/opt/codex-proxy"
if [[ ! -f "$PROXY_DIR/proxy.mjs" ]]; then
  fail "proxy.mjs 不存在: $PROXY_DIR/proxy.mjs"
fi

cd "$PROXY_DIR"
nohup node proxy.mjs >> "$LOG_DIR/proxy.log" 2>&1 &
PROXY_PID=$!
sleep 2

# 验证 proxy 健康
HEALTH=$(curl -sf http://127.0.0.1:9790/health 2>/dev/null || echo "FAIL")
if [[ "$HEALTH" == *"ok"* ]]; then
  pass "codex-proxy 运行中 (PID=$PROXY_PID)"
else
  fail "codex-proxy 健康检查失败: $HEALTH"
fi

# --- Step 2: 检查 Prompt Canvas server ---
log "--- Step 2: 检查 Prompt Canvas server ---"
CANVAS_HEALTH=$(curl -sf http://127.0.0.1:52846/api/health 2>/dev/null || echo "FAIL")
if [[ "$CANVAS_HEALTH" == *"ok"* ]]; then
  pass "Prompt Canvas server 运行中"
else
  log "Prompt Canvas 未运行，尝试启动..."
  cd "$PROJECT_DIR"
  nohup python3 server.py >> "$LOG_DIR/canvas.log" 2>&1 &
  sleep 3
  CANVAS_HEALTH=$(curl -sf http://127.0.0.1:52846/api/health 2>/dev/null || echo "FAIL")
  if [[ "$CANVAS_HEALTH" == *"ok"* ]]; then
    pass "Prompt Canvas server 已启动"
  else
    fail "Prompt Canvas server 启动失败"
  fi
fi

# --- Step 3: 验证模型可访问 ---
log "--- Step 3: 验证 mimo-v2.5-pro 模型可访问 ---"
MODEL_RESP=$(curl -sf http://127.0.0.1:9790/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{"model":"mimo-v2.5-pro","input":"say hi in 3 words","stream":false}' 2>/dev/null || echo "FAIL")

if [[ "$MODEL_RESP" == *"output_text"* ]]; then
  pass "mimo-v2.5-pro 模型可访问"
else
  log "模型响应: ${MODEL_RESP:0:200}"
  fail "mimo-v2.5-pro 不可访问"
fi

# --- Step 4: 验证 MCP server ---
log "--- Step 4: 验证 MCP server 注册 ---"
MCP_LIST=$(codex mcp list 2>/dev/null || echo "FAIL")
if [[ "$MCP_LIST" == *"prompt_canvas"* ]]; then
  pass "MCP server 'prompt_canvas' 已注册"
else
  log "MCP 列表: $MCP_LIST"
  log "尝试注册 MCP server..."
  codex mcp add prompt_canvas -- python3 "$PROJECT_DIR/mcp-server/prompt_canvas_mcp.py" 2>&1 | tee -a "$LOG_FILE"
  pass "MCP server 'prompt_canvas' 已注册"
fi

# --- Step 5: 运行 Codex 生图测试 ---
log "--- Step 5: 运行 Codex 生图测试 ---"
log "开始 codex exec (timeout=5min)..."

# 设置 OPENAI_BASE_URL 让 Codex image_gen CLI fallback 走 proxy 的 images 透传
export OPENAI_BASE_URL="http://127.0.0.1:9790/v1"

CODEX_OUTPUT=$(timeout 300 codex exec \
  -s danger-full-access \
  --cd "$PROJECT_DIR" \
  --skip-git-repo-check \
  "使用 image_gen CLI fallback 模式生成一张真实的测试图片（风景或食物均可），命令示例：python3 \$IMAGE_GEN generate --prompt \"...\" --size 1024x1024 --quality low --out output/imagegen/test.png。生成后把图片复制到 Prompt Canvas 画布的 assets 目录，用 MCP 工具 prompt_canvas_create_ai_image_holder 和 prompt_canvas_fill_ai_image_holder 放到画布上。完成后告诉我画布链接。" \
  2>&1) || true

log "--- Codex 输出开始 ---"
echo "$CODEX_OUTPUT" | tee -a "$LOG_FILE"
log "--- Codex 输出结束 ---"

# --- Step 6: 验证结果 ---
log "--- Step 6: 验证结果 ---"

# 查询最新 canvas 列表
CANVAS_LIST=$(curl -sf http://127.0.0.1:52846/api/canvas 2>/dev/null || echo "{}")

# 找到最新的有图片的 canvas
LATEST_CANVAS=$(echo "$CANVAS_LIST" | python3 -c "
import json, sys
data = json.load(sys.stdin)
canvases = data.get('canvases', [])
# 找 image_count > 0 的最新 canvas
with_images = [c for c in canvases if c.get('image_count', 0) > 0]
if with_images:
    c = with_images[0]
    print(f'{c[\"id\"]}|{c[\"image_count\"]}|{c.get(\"updated_at\",\"\")}')
else:
    print('NONE')
" 2>/dev/null || echo "NONE")

if [[ "$LATEST_CANVAS" != "NONE" ]]; then
  CANVAS_ID=$(echo "$LATEST_CANVAS" | cut -d'|' -f1)
  IMG_COUNT=$(echo "$LATEST_CANVAS" | cut -d'|' -f2)
  UPDATED=$(echo "$LATEST_CANVAS" | cut -d'|' -f3)

  # 检查是否有填充了 image_url 的 shape
  STATE=$(curl -sf "http://127.0.0.1:52846/api/state?canvas=$CANVAS_ID" 2>/dev/null || echo "{}")
  FILLED=$(echo "$STATE" | python3 -c "
import json, sys
data = json.load(sys.stdin)
shapes = data.get('shapes', {})
filled = [s for s in shapes.values() if s.get('image_url')]
print(len(filled))
" 2>/dev/null || echo "0")

  if [[ "$FILLED" -gt "0" ]]; then
    pass "成功! Canvas=$CANVAS_ID, 已填充图片数=$FILLED"
    log "画布链接: https://canvas.aixifs.com/?canvas=$CANVAS_ID"
  else
    log "Canvas=$CANVAS_ID 存在但图片未填充 (shapes有$IMG_COUNT个，但image_url为空)"
    fail "图片生成流程未完成"
  fi
else
  fail "未找到包含图片的 Canvas"
fi

log "========== 测试完成 =========="
