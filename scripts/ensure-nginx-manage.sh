#!/usr/bin/env bash
# Idempotent: add `location ^~ /manage` to the apex nginx config so guest
# email links (https://macaroonie.com/manage/:token) hit Fastify instead of
# the admin SPA (which wraps every route in Auth0).
#
# Safe to run on every deploy. No-op if the location already exists.
set -euo pipefail

CONF="${NGINX_CONF:-/etc/nginx/sites-available/macaroonie}"

if [[ ! -f "$CONF" ]]; then
  echo "nginx conf not found at $CONF — skip"
  exit 0
fi

if grep -q 'location ^~ /manage' "$CONF"; then
  echo "nginx already proxies /manage — skip"
  exit 0
fi

python3 - "$CONF" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = "location ^~ /reservations"
if needle not in text:
    # Fall back: insert before the admin SPA catch-all.
    needle = "location / {"
    if needle not in text:
        raise SystemExit(f"no insertion point in {path}")

block = """\
  # Guest booking manage links (emails). Must use ^~ so the admin SPA
  # catch-all does not swallow /manage/:token and send guests to Auth0.
  location ^~ /manage {
    limit_req zone=widget_limit burst=20 nodelay;
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
    proxy_buffering    off;
  }

"""
# Insert in every server block (certbot duplicates HTTP + HTTPS).
text = text.replace(needle, block + "  " + needle)
path.write_text(text)
print(f"inserted /manage location into {path}")
PY

nginx -t
# Full restart: CLAUDE.md notes reload can leave workers on the old
# location-matching table when ^~ is added.
if command -v systemctl >/dev/null; then
  systemctl restart nginx
else
  nginx -s reload
fi
echo "nginx restarted with /manage → API"
