#!/usr/bin/env bash
# Stop and remove the Sidecar auto-start launchd agents.
set -e
launchctl unload "$HOME/Library/LaunchAgents/com.sidecar.crm.plist"    2>/dev/null || true
launchctl unload "$HOME/Library/LaunchAgents/com.sidecar.tunnel.plist" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/com.sidecar.crm.plist"
rm -f "$HOME/Library/LaunchAgents/com.sidecar.tunnel.plist"
echo "✓ Auto-start removed. CRM and tunnel no longer run at login."
