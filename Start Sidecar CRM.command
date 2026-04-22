#!/usr/bin/env bash
# Double-click this file from Finder to start the Sidecar CRM + tunnel.
# A Terminal window opens and stays open showing live logs. Close the
# window (or press Ctrl+C) to stop everything.

# Move to the project directory (where this .command file lives)
cd "$(dirname "$0")"

clear
cat <<'BANNER'
╔══════════════════════════════════════════════════════════╗
║            SIDECAR ADVISORY — CRM + PORTAL               ║
║                                                          ║
║  Internal CRM:  https://app.sidecaradvisory.com/internal ║
║  Client Portal: https://app.sidecaradvisory.com/portal   ║
║                                                          ║
║  Close this window or press Ctrl+C to stop.              ║
╚══════════════════════════════════════════════════════════╝

BANNER

# Stop any previously-running instance so we don't double-bind port 3000
echo "▸ Cleaning up any stale processes…"
pkill -9 -f "node server.js"        >/dev/null 2>&1 || true
pkill -9 -f "cloudflared tunnel"    >/dev/null 2>&1 || true
sleep 1

# Start the server in the background
echo "▸ Starting CRM server (localhost:3000)…"
node server.js &
SERVER_PID=$!

# Stop the server when this window closes / Ctrl+C is pressed
trap "echo ''; echo '▸ Shutting down…'; kill $SERVER_PID 2>/dev/null; pkill -f 'cloudflared tunnel' 2>/dev/null; exit 0" INT TERM EXIT

# Let the server boot before starting the tunnel
sleep 2

# Start the Cloudflare Tunnel in the foreground so its logs show here
echo "▸ Starting Cloudflare Tunnel…"
echo ""
cloudflared tunnel run sidecar-app
