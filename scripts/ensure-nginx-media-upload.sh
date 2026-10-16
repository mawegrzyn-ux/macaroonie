#!/usr/bin/env bash
# Idempotent: let media library uploads through nginx up to 160 MB.
#
# Menu screens play videos from the media library (migration 167), and a
# video is bigger than the 30 MB every admin server block allows
# (client_max_body_size 30M). Rather than raise that for every API route,
# this adds one location in front of `location /api/` in each server block
# that has one:
#
#   location ~ ^/api/media/items/(upload|[^/]+/replace)$ {
#     client_max_body_size 160M; proxy_request_buffering off; ...
#   }
#
# copying that block's proxy_pass (and limit_req) so it reaches the same
# API. The API still checks every file (routes/media.js: images 12 MB,
# videos 150 MB). A regex location wins over the plain /api/ prefix, and no
# other regex location in these blocks matches /api/... paths.
#
# Run by the deploy (as root). Restores every file and exits 1 if nginx -t
# fails afterwards. Env (for tests): NGINX_SITES (default
# /etc/nginx/sites-enabled), NGINX_CONF (main config for nginx -t -c),
# NO_RELOAD=1.
set -euo pipefail

SITES="${NGINX_SITES:-/etc/nginx/sites-enabled}"
TEST=(nginx -t -q)
[[ -n "${NGINX_CONF:-}" ]] && TEST=(nginx -t -q -c "$NGINX_CONF")

if [[ ! -d "$SITES" ]]; then
  echo "nginx sites not found at $SITES — skip"
  exit 0
fi

BACKUP=$(mktemp -d)
trap 'rm -rf "$BACKUP"' EXIT

CHANGED=$(python3 - "$SITES" "$BACKUP" <<'PY'
import os, re, shutil, sys

sites, backup = sys.argv[1], sys.argv[2]
MARK = 'location ~ ^/api/media/items/'
files = []
for entry in sorted(os.listdir(sites)):
    p = os.path.realpath(os.path.join(sites, entry))
    if os.path.isfile(p) and p not in files:
        files.append(p)

# `location /api/ {` ... its closing brace at the same indent.
API_BLOCK = re.compile(r'(?m)^([ \t]*)location /api/ \{\n(.*?)^\1\}[ \t]*\n', re.S)
changed = []
for i, path in enumerate(files):
    text = open(path).read()
    if 'location /api/ {' not in text:
        continue
    out, pos, n = [], 0, 0
    for m in API_BLOCK.finditer(text):
        indent, body = m.group(1), m.group(2)
        # Already there (in front of this block)?
        before = text[max(0, m.start() - 1200):m.start()]
        if MARK in before:
            continue
        proxy = re.search(r'(?m)^[ \t]*proxy_pass[ \t]+([^;]+);', body)
        if not proxy:
            continue
        limit = re.search(r'(?m)^[ \t]*(limit_req[^;]*;)', body)
        inner = indent + '  '
        lines = [
            indent + '# Media library uploads (menu screen videos up to 150 MB): scripts/ensure-nginx-media-upload.sh',
            indent + MARK + '(upload|[^/]+/replace)$ {',
        ]
        if limit:
            lines.append(inner + limit.group(1))
        lines += [
            inner + 'client_max_body_size 160M;',
            inner + 'proxy_request_buffering off;',
            inner + 'proxy_pass         ' + proxy.group(1).strip() + ';',
            inner + 'proxy_http_version 1.1;',
            inner + 'proxy_set_header   Host $host;',
            inner + 'proxy_set_header   X-Real-IP $remote_addr;',
            inner + 'proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;',
            inner + 'proxy_set_header   X-Forwarded-Proto $scheme;',
            inner + 'proxy_read_timeout 300s;',
            inner + 'proxy_send_timeout 300s;',
            indent + '}',
            '',
        ]
        out.append(text[pos:m.start()])
        out.append('\n'.join(lines) + '\n')
        pos = m.start()
        n += 1
    if not n:
        continue
    out.append(text[pos:])
    shutil.copy2(path, os.path.join(backup, str(i)))
    with open(os.path.join(backup, str(i) + '.path'), 'w') as f:
        f.write(path)
    open(path, 'w').write(''.join(out))
    changed.append(path + ' (' + str(n) + ')')
print('\n'.join(changed))
PY
)

if [[ -z "$CHANGED" ]]; then
  echo "nginx media uploads already allowed (or no /api/ blocks) — skip"
  exit 0
fi

echo "allowed big media uploads in:"
echo "$CHANGED" | sed 's/^/  /'

if ! "${TEST[@]}"; then
  echo "nginx -t failed: restoring" >&2
  for meta in "$BACKUP"/*.path; do
    [[ -e "$meta" ]] || continue
    cp -p "${meta%.path}" "$(cat "$meta")"
  done
  exit 1
fi

if [[ -z "${NO_RELOAD:-}" ]] && command -v systemctl >/dev/null; then
  systemctl reload nginx
fi
