#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BACKEND_URL="http://127.0.0.1:3001/health"
FRONTEND_URL="http://127.0.0.1:5173/"
FRONTEND_HEALTH="http://127.0.0.1:5173/health"

ok() { printf "\033[32m%s\033[0m\n" "$1"; }
warn() { printf "\033[33m%s\033[0m\n" "$1"; }
fail() { printf "\033[31m%s\033[0m\n" "$1"; }

has_command() {
  command -v "$1" >/dev/null 2>&1
}

http_ok() {
  curl -fsS --max-time 2 "$1" >/dev/null 2>&1
}

port_owner() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN 2>/dev/null | awk 'NR > 1 {print $1 " PID " $2}' | head -n 1
}

open_terminal() {
  local title="$1"
  local command="$2"
  osascript -e "tell application \"Terminal\" to do script \"printf '\\\033]0;${title}\\\007'; ${command}\"" >/dev/null
}

start_backend() {
  local cmd="cd '$ROOT/backend' && PORT=3001 npm start"
  open_terminal "简尚后端 3001" "$cmd"
}

start_frontend() {
  local cmd="cd '$ROOT/frontend-new' && npm run dev -- --host 127.0.0.1"
  open_terminal "简尚前端 5173" "$cmd"
}

wait_for() {
  local url="$1"
  local label="$2"
  for _ in {1..20}; do
    if http_ok "$url"; then
      ok "$label 已就绪"
      return 0
    fi
    sleep 0.5
  done
  warn "$label 暂未响应，请看对应 Terminal 窗口日志"
}

echo "== 简尚系统本地启动检查 =="
echo "项目目录：$ROOT"

if ! has_command node || ! has_command npm; then
  fail "缺少 node 或 npm，请先安装 Node.js"
  exit 1
fi

if http_ok "$BACKEND_URL"; then
  ok "后端 3001 已运行"
else
  owner="$(port_owner 3001 || true)"
  if [ -n "$owner" ]; then
    warn "3001 已被占用：$owner，但 /health 不通，请检查该进程"
  else
    warn "后端未运行，正在打开 Terminal 启动 3001..."
    start_backend
  fi
fi

if http_ok "$FRONTEND_HEALTH" || http_ok "$FRONTEND_URL"; then
  ok "前端 5173 已运行"
else
  owner="$(port_owner 5173 || true)"
  if [ -n "$owner" ]; then
    warn "5173 已被占用：$owner，但页面暂未响应，请检查该进程"
  else
    warn "前端未运行，正在打开 Terminal 启动 5173..."
    start_frontend
  fi
fi

if [ -n "$(port_owner 18790 || true)" ]; then
  ok "知识库 18790 已有服务监听"
else
  warn "知识库 18790 暂未监听；后端启动后会尝试拉起，不影响普通系统页面"
fi

wait_for "$BACKEND_URL" "后端"
wait_for "$FRONTEND_URL" "前端"

open "$FRONTEND_URL"
ok "已打开：$FRONTEND_URL"
