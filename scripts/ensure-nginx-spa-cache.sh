#!/usr/bin/env bash
# Idempotent: stop nginx caching index.html (1h) and sw.js (1y immutable).
# Those two headers are why a hard refresh still booted an old admin build.
set -euo pipefail

CONF="${NGINX_CONF:-/etc/nginx/sites-available/macaroonie}"
DIST="${APP_DIST:-/home/ubuntu/app/admin/dist}"

if [[ ! -f "$CONF" ]]; then
  echo "nginx conf not found at $CONF — skip"
  exit 0
fi

if grep -q 'registerSW.js' "$CONF" && grep -q 'no-store, must-revalidate' "$CONF"; then
  echo "nginx SPA cache headers already patched — skip"
  exit 0
fi

python3 - "$CONF" "$DIST" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
dist = sys.argv[2]
text = path.read_text()

# HTML shell: never cache. Live file has `$uri`; setup.sh template had `\$uri`.
old_html = """    try_files $uri $uri/ /index.html;
    expires 1h;"""
new_html = """    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires off;"""
if old_html in text:
    text = text.replace(old_html, new_html)
else:
    old_html_esc = r"""    try_files \$uri \$uri/ /index.html;
    expires 1h;"""
    if old_html_esc in text:
        text = text.replace(old_html_esc, new_html)

sw_block = f"""  location ~* (?:^|/)(sw\\.js|registerSW\\.js|workbox-.*\\.js)$ {{
    root {dist};
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires off;
    etag on;
  }}

  """

needle = r"location ~* \.(js|css|png"
if "registerSW.js" not in text and needle in text:
    text = text.replace(needle, sw_block + needle, 1)
    # Certbot duplicates HTTP+HTTPS — replace remaining copies too.
    if text.count(needle) > 1 and text.count("registerSW.js") == 1:
        text = text.replace(needle, sw_block + needle)

path.write_text(text)
print(f"patched SPA cache headers in {path}")
PY

nginx -t
if command -v systemctl >/dev/null; then
  systemctl restart nginx
else
  nginx -s reload
fi
echo "nginx restarted with no-cache HTML + sw.js"
