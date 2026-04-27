#!/usr/bin/env bash
# =============================================================================
# proxy-ch · macOS Connect Script
# Starts wstunnel client and configures system proxy.
# Usage: ./connect-macos.sh [start|stop|status]
# =============================================================================
set -euo pipefail

HOSTNAME="tcp.rapold.io"
LOCAL_PORT="8128"
REMOTE_PORT="38128"   # 3proxy HTTP CONNECT port on CT 105
PROXY_USER="chproxy"
WSTUNNEL_BIN="/usr/local/bin/wstunnel"
WSTUNNEL_LOG="/tmp/wstunnel-proxy.log"
WSTUNNEL_PID="/tmp/wstunnel-proxy.pid"
NETWORK_SERVICE="Wi-Fi"

install_wstunnel() {
  if command -v wstunnel &>/dev/null; then
    echo "wstunnel already installed: $(wstunnel --version)"
    return
  fi
  echo "Installing wstunnel..."
  ARCH=$(uname -m)
  [[ "$ARCH" == "arm64" ]] && ARCH_STR="arm64" || ARCH_STR="amd64"
  VER=$(curl -s https://api.github.com/repos/erebe/wstunnel/releases/latest \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['tag_name'])")
  VER_NUM="${VER#v}"
  URL="https://github.com/erebe/wstunnel/releases/download/${VER}/wstunnel_${VER_NUM}_darwin_${ARCH_STR}.tar.gz"
  TMP=$(mktemp -d)
  curl -sL "$URL" | tar -xz -C "$TMP"
  sudo mv "$TMP/wstunnel" "$WSTUNNEL_BIN"
  sudo chmod +x "$WSTUNNEL_BIN"
  echo "Installed wstunnel ${VER}"
}

start() {
  install_wstunnel

  if [[ -f "$WSTUNNEL_PID" ]] && kill -0 "$(cat "$WSTUNNEL_PID")" 2>/dev/null; then
    echo "wstunnel already running (PID $(cat $WSTUNNEL_PID))"
  else
    echo "Starting wstunnel → wss://${HOSTNAME} → localhost:${LOCAL_PORT}"
    "$WSTUNNEL_BIN" client \
      -L "tcp://127.0.0.1:${LOCAL_PORT}:127.0.0.1:${REMOTE_PORT}" \
      "wss://${HOSTNAME}" \
      > "$WSTUNNEL_LOG" 2>&1 &
    echo $! > "$WSTUNNEL_PID"
    sleep 2
    echo "wstunnel started (PID $(cat $WSTUNNEL_PID))"
  fi

  echo "Configuring macOS proxy → 127.0.0.1:${LOCAL_PORT}"
  networksetup -setwebproxy      "$NETWORK_SERVICE" 127.0.0.1 "$LOCAL_PORT" off
  networksetup -setsecurewebproxy "$NETWORK_SERVICE" 127.0.0.1 "$LOCAL_PORT" off

  echo ""
  echo "✅ CH proxy active!"
  echo "   Proxy:    http://127.0.0.1:${LOCAL_PORT}"
  echo "   User:     ${PROXY_USER}"
  echo "   Password: (see 1Password: proxy-ch)"
  echo ""
  echo "   Your IP via proxy:"
  curl -s --max-time 8 \
    --proxy "http://127.0.0.1:${LOCAL_PORT}" \
    https://ipinfo.io/ip 2>/dev/null || echo "(auth required — browser will prompt)"
}

stop() {
  if [[ -f "$WSTUNNEL_PID" ]]; then
    kill "$(cat "$WSTUNNEL_PID")" 2>/dev/null && echo "wstunnel stopped" || echo "wstunnel not running"
    rm -f "$WSTUNNEL_PID"
  fi
  networksetup -setwebproxystate      "$NETWORK_SERVICE" off
  networksetup -setsecurewebproxystate "$NETWORK_SERVICE" off
  echo "System proxy disabled"
}

status() {
  if [[ -f "$WSTUNNEL_PID" ]] && kill -0 "$(cat "$WSTUNNEL_PID")" 2>/dev/null; then
    echo "wstunnel: running (PID $(cat $WSTUNNEL_PID))"
  else
    echo "wstunnel: stopped"
  fi
  echo "System proxy: $(networksetup -getsecurewebproxy "$NETWORK_SERVICE" | grep Enabled)"
}

case "${1:-start}" in
  start)  start  ;;
  stop)   stop   ;;
  status) status ;;
  *) echo "Usage: $0 [start|stop|status]"; exit 1 ;;
esac
