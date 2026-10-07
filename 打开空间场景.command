#!/bin/bash
# 空间场景 macOS 一键启动：双击本文件启动本地服务并打开网页
# 行为与 Windows 版 start.ps1 对齐：复用同端口同目录的现有服务
set -u

DIR="$(cd "$(dirname "$0")" && pwd)"
PORT="${PORT:-4173}"
URL="http://127.0.0.1:${PORT}"
EXPECTED_ROOT="${DIR}/图"

fail() {
  printf '\n\033[31m%s\033[0m\n' "$1"
  read -r -p '按回车关闭...' _
  exit 1
}

api_root() {
  curl -s --max-time "${1:-2}" "${URL}/api/projects" 2>/dev/null \
    | sed -n 's/.*"root"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p'
}

# 端口上已有服务：同目录则直接打开浏览器，不同目录则报错
running_root="$(api_root 2 || true)"
if [ -n "$running_root" ]; then
  if [ "$running_root" = "$EXPECTED_ROOT" ]; then
    open "$URL"
    exit 0
  fi
  fail "端口 ${PORT} 正在运行另一个目录的空间场景（${running_root}）。请关闭该服务，或设置 PORT 后重试。"
fi

# 查找 Node.js 18+：系统 PATH → Homebrew → 用户目录解压版
find_node() {
  local n major matches
  n="$(command -v node 2>/dev/null || true)"
  if [ -z "$n" ]; then
    for c in /opt/homebrew/bin/node /usr/local/bin/node; do
      [ -x "$c" ] && { n="$c"; break; }
    done
  fi
  if [ -z "$n" ]; then
    matches="$(ls -d "$HOME"/.local/node-v*/bin/node 2>/dev/null | sort -V | tail -n 1)"
    n="$matches"
  fi
  [ -n "$n" ] && [ -x "$n" ] || return 0
  major="$("$n" -v 2>/dev/null | sed 's/v\([0-9]*\).*/\1/')"
  case "$major" in
    ''|*[!0-9]*) return 0 ;;
    *) [ "$major" -ge 18 ] && echo "$n" ;;
  esac
}
NODE="$(find_node)"
[ -n "$NODE" ] || fail "需要 Node.js 18 或更新版本。安装后重新双击启动；直接打开 index.html 仍可使用游客模式。"

LOG="${TMPDIR:-/tmp/}/空间场景-server.log"
cd "$DIR" || fail "无法进入项目目录：${DIR}"
nohup "$NODE" server.cjs >"$LOG" 2>&1 &
disown 2>/dev/null || true

# 等待服务就绪（最多约 6 秒）
for _ in $(seq 1 30); do
  sleep 0.2
  if [ "$(api_root 1 || true)" = "$EXPECTED_ROOT" ]; then
    open "$URL"
    exit 0
  fi
done

fail "服务启动失败，端口 ${PORT} 可能被占用。日志文件：${LOG}"
