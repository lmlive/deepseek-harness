#!/usr/bin/env bash
# ==============================================================================
# DeepSeek Harness (dsh) Web 服务统一管理脚本
# ==============================================================================
# 支持功能:
#   1. 通过 Tailscale 直连 Oracle Cloud SearXNG
#   2. 自动应用 0.0.0.0:8765 监听 patch
#   3. 自动应用 agent-team 团队协同支持 patch
#   4. 自动应用 searxng MCP 工具 patch
#   5. 后台常驻运行，支持 start / stop / restart / status / logs
# ==============================================================================

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="${ROOT_DIR}/.dsh-web.pid"
LOG_FILE="${ROOT_DIR}/.dsh-web.log"
SEARXNG_BASE_URL="${SEARXNG_BASE_URL:-http://100.101.179.90:8888}"
PORT="8765"

check_searxng() {
  local probe_url="${SEARXNG_BASE_URL%/}/search?q=dsh-health-check&format=json"
  echo "[*] 检查 Tailscale SearXNG: ${SEARXNG_BASE_URL}"
  if ! curl --noproxy '*' --fail --silent --show-error --max-time 15 \
    -H 'Accept: application/json' "$probe_url" >/dev/null; then
    echo "[x] 无法通过 Tailscale 访问 SearXNG: ${SEARXNG_BASE_URL}" >&2
    return 1
  fi
  echo "[✓] SearXNG 可用"
}

start() {
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE")"
    if kill -0 "$PID" 2>/dev/null; then
      echo "[!] dsh web 服务已在运行中 (PID: $PID)"
      status
      return 0
    else
      rm -f "$PID_FILE"
    fi
  fi

  # 1. 确保 Tailscale SearXNG 就绪
  check_searxng

  # 2. 准备基础 overlay patch
  PATCH_HOST="/tmp/webserver-0000.patch.yml"
  cat << 'EOF' > "$PATCH_HOST"
- id: webserver
  config:
    host: '0.0.0.0'
    port: 8765
EOF

  echo "[*] 启动 dsh web 服务..."
  cd "$ROOT_DIR"

  SEARXNG_BASE_URL="$SEARXNG_BASE_URL" nohup node --import tsx/esm apps/cli/src/bin.ts --profile web \
    --patch "$PATCH_HOST" \
    --patch "${ROOT_DIR}/agent-team/patch.yml" \
    --patch "${ROOT_DIR}/searxng-mcp/searxng.patch.yml" \
    --trusted-host dsh.jp.a123.dpdns.org \
    --no-open > "$LOG_FILE" 2>&1 &

  MAIN_PID=$!
  echo "$MAIN_PID" > "$PID_FILE"

  # 等待服务就绪并打印访问链接
  echo "[*] 等待服务监听就绪..."
  sleep 3

  if kill -0 "$MAIN_PID" 2>/dev/null; then
    echo "[✓] dsh web 启动成功 (PID: $MAIN_PID)"
    echo ""
    echo "=================================================================="
    grep -E "dsh web:" "$LOG_FILE" | tail -n 1 || echo "正在生成访问 Token，请稍后查看 logs..."
    echo "日志文件: $LOG_FILE"
    echo "=================================================================="
  else
    echo "[x] 启动失败，最近日志:"
    tail -n 20 "$LOG_FILE"
    exit 1
  fi
}

stop() {
  if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE")"
    if kill -0 "$PID" 2>/dev/null; then
      echo "[*] 正在停止 dsh web 服务 (PID: $PID)..."
      kill "$PID" 2>/dev/null || true
      for i in {1..10}; do
        if ! kill -0 "$PID" 2>/dev/null; then
          break
        fi
        sleep 0.5
      done
      if kill -0 "$PID" 2>/dev/null; then
        echo "[*] 强制终止 (kill -9 $PID)..."
        kill -9 "$PID" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
    echo "[✓] dsh web 服务已停止"
  else
    echo "[-] 未发现运行中的 dsh web PID"
  fi
}

status() {
  echo "=== dsh web 服务状态 ==="
  if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
    echo "状态: [运行中] (PID: $(cat "$PID_FILE"))"
    echo "端口: $(ss -tulpn | grep "$PORT" | awk '{print $1, $5}' || echo "未在监听 $PORT")"
    echo "最新访问链接:"
    grep -E "dsh web:" "$LOG_FILE" | tail -n 1 || echo "暂无链接"
  else
    echo "状态: [已停止]"
  fi

  echo ""
  echo "=== SearXNG Tailscale 状态 ==="
  echo "地址: ${SEARXNG_BASE_URL}"
  if check_searxng; then
    echo "状态: [可用]"
  else
    echo "状态: [不可用]"
  fi
}

logs() {
  if [ -f "$LOG_FILE" ]; then
    tail -f -n 50 "$LOG_FILE"
  else
    echo "日志文件不存在: $LOG_FILE"
  fi
}

case "${1:-status}" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    stop
    sleep 1
    start
    ;;
  status)
    status
    ;;
  logs)
    logs
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
