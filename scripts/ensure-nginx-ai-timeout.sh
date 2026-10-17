#!/usr/bin/env bash
# Idempotent: give Pepper's chat (/api/ai/) up to 5 minutes to answer.
#
# A Pepper turn can make several model calls (looking things up, reading an
# attached photo, building a menu) before it replies, and the reply only
# comes at the end. Every admin server block proxies /api/ with
# proxy_read_timeout 60s, so a turn over a minute showed an error while the
# API carried on and saved the reply. Rather than raise that for every API
# route, this adds one location in front of `location /api/` in each server
# block that has one:
#
#   location ^~ /api/ai/ {
#     proxy_read_timeout 300s; proxy_buffering off; ...
#   }
#
# copying that block's proxy_pass (and limit_req) so it reaches the same
# API. ^~ makes the prefix final, so no regex location (static files, media
# uploads) can take /api/ai/ paths.
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
MARK = 'location ^~ /api/ai/ {'
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
    out, pos, n, prev_end = [], 0, 0, 0
    for m in API_BLOCK.finditer(text):
        indent, body = m.group(1), m.group(2)
        # Already there? Look at everything since the previous /api/ block:
        # this server block's locations in front of its /api/ block.
        seen = MARK in text[prev_end:m.start()]
        prev_end = m.end()
        if seen:
            continue
        proxy = re.search(r'(?m)^[ \t]*proxy_pass[ \t]+([^;]+);', body)
        if not proxy:
            continue
        limit = re.search(r'(?m)^[ \t]*(limit_req[^;]*;)', body)
        inner = indent + '  '
        lines = [
            indent + '# Pepper chat turns can take minutes: scripts/ensure-nginx-ai-timeout.sh',
            indent + MARK,
        ]
        if limit:
            lines.append(inner + limit.group(1))
        lines += [
            inner + 'proxy_pass         ' + proxy.group(1).strip() + ';',
            inner + 'proxy_http_version 1.1;',
            inner + 'proxy_set_header   Host $host;',
            inner + 'proxy_set_header   X-Real-IP $remote_addr;',
            inner + 'proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;',
            inner + 'proxy_set_header   X-Forwarded-Proto $scheme;',
            inner + 'proxy_read_timeout 300s;',
            inner + 'proxy_send_timeout 300s;',
            inner + 'proxy_buffering    off;',
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
  echo "nginx Pepper timeout already set (or no /api/ blocks) — skip"
  exit 0
fi

echo "gave Pepper's chat 5 minutes in:"
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
