#!/usr/bin/env bash
# Install launchd agents so the CRM server + Cloudflare Tunnel auto-start
# at login and auto-restart if they crash.

set -e
cd "$(dirname "$0")"

mkdir -p "$HOME/Library/LaunchAgents"
mkdir -p "$HOME/Library/Logs"

cp com.sidecar.crm.plist    "$HOME/Library/LaunchAgents/"
cp com.sidecar.tunnel.plist "$HOME/Library/LaunchAgents/"

# Unload if already loaded (ignore errors)
launchctl unload "$HOME/Library/LaunchAgents/com.sidecar.crm.plist"    2>/dev/null || true
launchctl unload "$HOME/Library/LaunchAgents/com.sidecar.tunnel.plist" 2>/dev/null || true

# Load
launchctl load "$HOME/Library/LaunchAgents/com.sidecar.crm.plist"
launchctl load "$HOME/Library/LaunchAgents/com.sidecar.tunnel.plist"

echo "✓ Auto-start installed."
echo ""
echo "Both services are now running and will start automatically on login."
echo ""
echo "Check status:  launchctl list | grep sidecar"
echo "View logs:     tail -f ~/Library/Logs/sidecar-crm.log"
echo "               tail -f ~/Library/Logs/sidecar-tunnel.log"
echo ""
echo "To uninstall:  ./scripts/uninstall-autostart.sh"
