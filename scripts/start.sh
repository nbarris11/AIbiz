#!/usr/bin/env bash
# Start the CRM server + Cloudflare Tunnel together.
# Ctrl+C stops both.

set -e
cd "$(dirname "$0")/.."

# Start the server in the background
node server.js &
SERVER_PID=$!

# Cleanup on exit
trap "kill $SERVER_PID 2>/dev/null; exit" INT TERM

# Wait a moment, then start the tunnel (blocks until Ctrl+C)
sleep 2
echo "[tunnel] Starting Cloudflare Tunnel…"
cloudflared tunnel run sidecar-app

# If tunnel exits, also kill the server
kill $SERVER_PID 2>/dev/null
