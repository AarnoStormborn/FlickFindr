#!/bin/sh
# Generate /usr/share/nginx/html/config.js from the API_BASE_URL env var.
# Runs before nginx starts (docker-entrypoint.d). Falls back to same-origin.
set -e

API="${API_BASE_URL:-}"

cat > /usr/share/nginx/html/config.js <<EOF
window.__FLICKFINDR_API__ = "${API}";
EOF

echo "[config] wrote config.js with API base '${API}'"
