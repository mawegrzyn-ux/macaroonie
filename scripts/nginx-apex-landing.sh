#!/usr/bin/env bash
# Switches the apex (macaroonie.com) from serving the admin portal to the
# platform page (routes/platformSite.js), which also redirects old admin paths
# to office.<domain> and retires the old installed admin (a self-removing sw.js).
#
# Run once, on the server, as root, AFTER office.<domain> works
# (scripts/nginx-office-ops.sh) and Auth0 allows it:
#   sudo bash scripts/nginx-apex-landing.sh
#
# In every server block of the apex config it replaces:
#   location / { root admin/dist; try_files ... }   → proxy to the API
#   the sw.js / registerSW.js location                → proxy to the API
# API paths (/api, /manage, /reservations, /webhooks, ...) are unchanged, and
# so is the static-file location (the page uses /favicon.svg from admin/dist).
# Keeps a dated backup and restores it if nginx -t fails. Safe to run again.
set -euo pipefail

CONF="${NGINX_CONF:-/etc/nginx/sites-available/macaroonie}"
UPSTREAM="${UPSTREAM:-booking_api}"

if [[ ! -f "$CONF" ]]; then
  echo "nginx conf not found at $CONF" >&2
  exit 1
fi
if grep -q 'apex: platform page' "$CONF"; then
  echo "apex already serves the platform page — skip"
  exit 0
fi

BACKUP="${CONF}.bak-$(date +%Y%m%d%H%M%S)"
cp "$CONF" "$BACKUP"

python3 - "$CONF" "$UPSTREAM" <<'PY'
import re, sys
from pathlib import Path

path, upstream = Path(sys.argv[1]), sys.argv[2]
text = path.read_text()

proxy = """{
    # apex: platform page (routes/platformSite.js), written by scripts/nginx-apex-landing.sh
    proxy_pass         http://%s;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }""" % upstream

def swap(pattern, must_contain):
    global text
    count = 0
    def repl(m):
        nonlocal count
        if must_contain not in m.group(2):
            return m.group(0)
        count += 1
        return m.group(1) + proxy
    text = re.sub(pattern, repl, text)
    return count

# location / { ... }  (the admin SPA: root + try_files, no nested braces)
spa = swap(r'(location\s+/\s*)(\{[^{}]*\})', 'try_files')
# the service-worker location
sw = swap(r'(location\s+~\*\s+[^{\n]*sw\\\\?\.js[^{\n]*)(\{[^{}]*\})', 'root')

if spa == 0:
    raise SystemExit('no admin "location / { ... try_files ... }" block found')
path.write_text(text)
print(f"switched {spa} location / block(s) and {sw} sw.js block(s) to the API")
PY

if ! nginx -t; then
  echo "nginx -t failed — restoring $BACKUP" >&2
  cp "$BACKUP" "$CONF"
  exit 1
fi
systemctl restart nginx
echo "apex now serves the platform page. Backup: $BACKUP"
