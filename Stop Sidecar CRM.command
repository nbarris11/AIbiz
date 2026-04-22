#!/usr/bin/env bash
# Double-click to stop the Sidecar CRM + tunnel.
clear
echo "▸ Stopping CRM server and Cloudflare Tunnel…"
pkill -9 -f "node server.js"     >/dev/null 2>&1 && echo "  • Server stopped" || echo "  • Server was not running"
pkill -9 -f "cloudflared tunnel" >/dev/null 2>&1 && echo "  • Tunnel stopped" || echo "  • Tunnel was not running"
echo ""
echo "Done. This window will close in 3 seconds…"
sleep 3
osascript -e 'tell application "Terminal" to close (every window whose name contains "Stop Sidecar CRM")' &
exit 0
