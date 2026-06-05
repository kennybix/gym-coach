#!/usr/bin/env bash
# Expose gym-coach to YOUR tailnet over HTTPS — private (Tailscale Serve, NOT Funnel).
# Only devices signed into your tailnet can reach it; nothing is public.
#
# The frontend (:3010) serves the UI and proxies /api,/coach,/knowledge to the backend
# (Next.js rewrites), so a single root mount is all that's needed.
#
# Prereq (one-time, admin console): enable HTTPS certificates for the tailnet at
#   https://login.tailscale.com/admin/dns  →  "Enable HTTPS"
#
# Run:  sudo bash deploy/tailscale-serve.sh
#   (or run `sudo tailscale set --operator=$USER` once, then run this without sudo)
set -euo pipefail

tailscale serve reset || true
tailscale serve --bg http://127.0.0.1:3010

echo
echo "Serving on your tailnet:"
tailscale serve status
echo
echo "Open on any tailnet device:  https://quantoptimus.taile8b1de.ts.net"

# To make it PUBLIC instead (anyone with the URL — add an auth layer first!):
#   sudo tailscale funnel --bg 443
# To take it down:
#   sudo tailscale serve reset
