#!/usr/bin/env bash
# =============================================================================
# setup-lxc.sh  —  Bootstrap 3proxy + fail2ban + nftables + dashboard
#                  inside Debian 12 LXC CT 105
# =============================================================================
# Run as root inside the container:
#   bash setup-lxc.sh
#
# Environment variables (required):
#   PROXY_USERNAME   — 3proxy username
#   PROXY_PASSWORD   — 3proxy password (plaintext)
# =============================================================================
set -euo pipefail

: "${PROXY_USERNAME:?PROXY_USERNAME is required}"
: "${PROXY_PASSWORD:?PROXY_PASSWORD is required}"

INSTALL_DIR="/usr/local/3proxy"
DASHBOARD_DIR="/opt/proxy-dashboard"

echo "▶ Updating packages…"
apt-get update -qq
apt-get install -y -qq build-essential git nftables fail2ban python3 python3-pip python3-venv

# ── 3proxy ───────────────────────────────────────────────────────────────────
echo "▶ Building 3proxy…"
rm -rf /tmp/3proxy-src
git clone --depth 1 https://github.com/3proxy/3proxy.git /tmp/3proxy-src
cd /tmp/3proxy-src
make -f Makefile.Linux -j"$(nproc)" 2>&1 | tail -5
make -f Makefile.Linux install

mkdir -p "${INSTALL_DIR}"/{conf,logs,pid}
id 3proxy &>/dev/null || useradd -r -s /usr/sbin/nologin 3proxy
chown -R 3proxy:3proxy "${INSTALL_DIR}"

# Config
cp /tmp/deploy/3proxy/3proxy.cfg "${INSTALL_DIR}/conf/3proxy.cfg"
echo "${PROXY_USERNAME}:CL:${PROXY_PASSWORD}" > "${INSTALL_DIR}/conf/passwd"
chmod 600 "${INSTALL_DIR}/conf/passwd"
chown 3proxy:3proxy "${INSTALL_DIR}/conf/passwd"

# systemd
cp /tmp/deploy/3proxy/3proxy.service /etc/systemd/system/3proxy.service
systemctl daemon-reload
systemctl enable --now 3proxy
echo "  3proxy: $(systemctl is-active 3proxy)"

# ── nftables ─────────────────────────────────────────────────────────────────
echo "▶ Configuring nftables…"
cp /tmp/deploy/nftables/nftables.conf /etc/nftables.conf
systemctl enable --now nftables
nft -f /etc/nftables.conf
echo "  nftables: active"

# ── fail2ban ─────────────────────────────────────────────────────────────────
echo "▶ Configuring fail2ban…"
cp /tmp/deploy/fail2ban/filter.d/3proxy.conf /etc/fail2ban/filter.d/3proxy.conf
cp /tmp/deploy/fail2ban/jail.d/3proxy.local   /etc/fail2ban/jail.d/3proxy.local
cp /tmp/deploy/fail2ban/jail.d/00-disable-defaults.local /etc/fail2ban/jail.d/00-disable-defaults.local
systemctl enable --now fail2ban
systemctl reload fail2ban
echo "  fail2ban: $(systemctl is-active fail2ban)"

# ── Dashboard ─────────────────────────────────────────────────────────────────
echo "▶ Installing dashboard…"
mkdir -p "${DASHBOARD_DIR}"
cp /tmp/deploy/dashboard/dashboard.py  "${DASHBOARD_DIR}/"
cp /tmp/deploy/dashboard/index.html    "${DASHBOARD_DIR}/"
cp /tmp/deploy/dashboard/requirements.txt "${DASHBOARD_DIR}/"

python3 -m venv "${DASHBOARD_DIR}/venv"
"${DASHBOARD_DIR}/venv/bin/pip" install -q -r "${DASHBOARD_DIR}/requirements.txt"

cp /tmp/deploy/dashboard/dashboard.service /etc/systemd/system/proxy-dashboard.service
systemctl daemon-reload
systemctl enable --now proxy-dashboard
echo "  dashboard: $(systemctl is-active proxy-dashboard)"

echo ""
echo "✅ Setup complete."
echo "   HTTP proxy  → port 38128"
echo "   SOCKS5      → port 31080"
echo "   Dashboard   → http://192.168.1.50:8080"
