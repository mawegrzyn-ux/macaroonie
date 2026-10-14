#!/usr/bin/env bash
# Idempotent: stop nginx warning "protocol options redefined for 0.0.0.0:443".
#
# nginx warns when server blocks on the same address disagree about http2,
# e.g. the apex block certbot wrote has `listen 443 ssl;` while a custom
# domain block (scripts/nginx-custom-domain.sh) has `listen 443 ssl http2;`.
# On nginx 1.24 http2 belongs to the listening socket: once any block on an
# address has it, every name on that address is already served over HTTP/2.
# So adding `http2` to the other `listen ... ssl` lines on that address
# changes nothing but the warning. Never removes http2, never touches an
# address where no block has it, and leaves non-ssl listens alone.
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
from pathlib import Path

sites, backup = sys.argv[1], sys.argv[2]
files = []
for entry in sorted(os.listdir(sites)):
    p = os.path.realpath(os.path.join(sites, entry))
    if os.path.isfile(p) and p not in files:
        files.append(p)

# `listen <address> <options>;` up to the semicolon (a comment may follow).
LISTEN = re.compile(r'^(\s*listen\s+)(\S+)([^;#]*);')

def address(token):
    if token.isdigit():
        return '0.0.0.0:' + token
    if token.startswith('*:'):
        return '0.0.0.0:' + token[2:]
    return token

lines = {}
seen = {}   # address -> set of has-http2 flags across ssl listens
for f in files:
    text = Path(f).read_text().split('\n')
    lines[f] = text
    for line in text:
        m = LISTEN.match(line)
        if not m:
            continue
        opts = m.group(3).split()
        if 'ssl' not in opts:
            continue
        seen.setdefault(address(m.group(2)), set()).add('http2' in opts)

needs = {a for a, flags in seen.items() if flags == {True, False}}
changed = []
for f, text in lines.items():
    out, touched = [], False
    for line in text:
        m = LISTEN.match(line)
        if m and address(m.group(2)) in needs:
            opts = m.group(3).split()
            if 'ssl' in opts and 'http2' not in opts:
                opts.insert(opts.index('ssl') + 1, 'http2')
                line = m.group(1) + m.group(2) + ' ' + ' '.join(opts) + ';' + line[m.end():]
                touched = True
        out.append(line)
    if touched:
        shutil.copy2(f, os.path.join(backup, str(len(changed))))
        Path(f).write_text('\n'.join(out))
        changed.append(f)

for i, f in enumerate(changed):
    print(f'{i}\t{f}')
PY
)

if [[ -z "$CHANGED" ]]; then
  echo "nginx https listens already agree on http2 — skip"
  exit 0
fi

if ! "${TEST[@]}"; then
  while IFS=$'\t' read -r i f; do cp -p "$BACKUP/$i" "$f"; done <<< "$CHANGED"
  echo "nginx -t failed after adding http2; restored the files"
  exit 1
fi

while IFS=$'\t' read -r _ f; do echo "added http2 to the https listens in $f"; done <<< "$CHANGED"
if [[ -z "${NO_RELOAD:-}" ]]; then
  if command -v systemctl >/dev/null; then systemctl reload nginx; else nginx -s reload; fi
fi
