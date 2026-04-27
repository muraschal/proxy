#!/usr/bin/env bash
# Install wstunnel on CT 105 (Debian/Ubuntu)
set -euo pipefail

WSTUNNEL_VER="v10.5.2"
ARCH="amd64"

echo "==> Installing wstunnel ${WSTUNNEL_VER}"
wget -q "https://github.com/erebe/wstunnel/releases/download/${WSTUNNEL_VER}/wstunnel_${WSTUNNEL_VER#v}_linux_${ARCH}.tar.gz" -O /tmp/wstunnel.tgz
tar -xzf /tmp/wstunnel.tgz -C /usr/local/bin/ wstunnel
chmod +x /usr/local/bin/wstunnel
/usr/local/bin/wstunnel --version

echo "==> Installing systemd services"
cp wstunnel-proxy.service /etc/systemd/system/
cp wstunnel-socks.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now wstunnel-proxy wstunnel-socks

echo "==> Adding firewall rules"
nft add rule inet filter input tcp dport 8383 accept
nft add rule inet filter input tcp dport 8384 accept
nft list ruleset > /etc/nftables.conf

echo "==> Done! wstunnel services:"
systemctl is-active wstunnel-proxy wstunnel-socks
