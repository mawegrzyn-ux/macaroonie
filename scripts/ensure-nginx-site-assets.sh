#!/usr/bin/env bash
# Idempotent: add `location ^~ /site/` to the apex nginx config so the
# platform site's own files (macaroonie.com/site/site.css, site.js and the
# screenshots, served by routes/platformSite.js from api/platform-site/) reach
# the API.
#
# Without it the apex's static-file location (a regex on .css, .js, .png ...)
# wins over `location /` and looks for them in the admin's build: the pages
# load with no styles, script or pictures. ^~ stops nginx checking the regex
# locations once the prefix matches (the same trap as /uploads/ and /manage).
#
# Run by the deploy (as root). Safe on every deploy: no-op once the location
# exists. Restores the file and exits 1 if nginx -t fails.
set -euo pipefail

CONF="${NGINX_CONF:-/etc/nginx/sites-available/macaroonie}"

if [[ ! -f "$CONF" ]]; then
  echo "nginx conf not found at $CONF — skip"
  exit 0
fi

if grep -q 'location ^~ /site/' "$CONF"; then
  echo "nginx already proxies /site/ — skip"
  exit 0
fi

BACKUP="$(mktemp)"
cp -p "$CONF" "$BACKUP"
trap 'rm -f "$BACKUP"' EXIT

python3 - "$CONF" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
needle = "location ^~ /manage"
if needle not in text:
    needle = "location /api/"
    if needle not in text:
        raise SystemExit(f"no insertion point in {path}")

block = """\
  # The platform site's CSS, JS and screenshots (routes/platformSite.js).
  # ^~ so the static-file regex doesn't look for them in the admin's build.
  # Written by scripts/ensure-nginx-site-assets.sh.
  location ^~ /site/ {
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Host $host;
    proxy_set_header   X-Real-IP $remote_addr;
    proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }

"""
# Every server block that has the needle (certbot keeps HTTP and HTTPS ones).
text = text.replace(needle, block + "  " + needle)
path.write_text(text)
print(f"inserted /site/ location into {path}")
PY

if ! nginx -t; then
  echo "nginx -t failed: restoring $CONF" >&2
  cp -p "$BACKUP" "$CONF"
  exit 1
fi
# A full restart: a reload can leave workers on the old location table when a
# ^~ location is added (see ensure-nginx-manage.sh).
if command -v systemctl >/dev/null; then
  systemctl restart nginx
else
  nginx -s reload
fi
echo "nginx restarted with /site/ → API"
