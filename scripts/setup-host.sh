#!/usr/bin/env bash
# =============================================================================
# setup-host.sh  —  Bootstrap cloudflared on Proxmox host (pve-1)
# =============================================================================
# Run as root on pve-1 AFTER the LXC is set up.
#
# Environment variables (required):
#   CF_TUNNEL_ID   — Cloudflare Tunnel UUID
# =============================================================================
set -euo pipefail

: "${CF_TUNNEL_ID:?CF_TUNNEL_ID is required}"

echo "▶ Installing cloudflared…"
curl -fsSL "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb" -o /tmp/cloudflared.deb
dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

echo "▶ Deploying tunnel config…"
mkdir -p /etc/cloudflared
sed "s/\${CF_TUNNEL_ID}/${CF_TUNNEL_ID}/g" /tmp/deploy/cloudflared/proxy-ch.yml > /etc/cloudflared/proxy-ch.yml

cp /tmp/deploy/cloudflared/cloudflared-proxy-ch.service /etc/systemd/system/cloudflared-proxy-ch.service
systemctl daemon-reload
systemctl enable --now cloudflared-proxy-ch

echo ""
echo "✅ cloudflared service started."
echo "   Verify: journalctl -u cloudflared-proxy-ch --no-pager | tail -20"
