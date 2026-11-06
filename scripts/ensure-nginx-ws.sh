#!/usr/bin/env bash
# Idempotent: every server block that proxies to the API passes live
# connections (WebSockets at /ws) through.
#
# Tills, kitchen screens, kiosks, menu screens and the live kitchen view open
# a WebSocket at /ws on their own address (pos., kitchen., kiosk., screens.)
# to hear about changes at once. A server block that proxies everything with
# `location / { proxy_pass ...; }` but doesn't send the Upgrade headers turns
# that into a plain GET: no live connection, so the device asks every few
# seconds instead (the live kitchen view shows "Checking every few seconds").
# And one that does send them still closes a quiet connection after its 60 s
# read timeout. This adds, in each server block that has a proxy_pass and no
# /ws location, in front of its first location:
#
#   location /ws {
#     proxy_pass <that block's own API address>;
#     proxy_http_version 1.1;
#     proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "Upgrade";
#     ... proxy_read_timeout 3600s;
#   }
#
# The address comes from the block's `location /` (else `location /api/`, else
# its first location with a proxy_pass), without any path. Blocks that only
# redirect or answer certificate checks (no proxy_pass) are left alone, and so
# are tenants' custom domain files (macaroonie-domain-*: guest sites, no
# devices; scripts/custom-domains-sync.sh owns them).
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
NOTE = '# Live connections for tills, kitchen screens, kiosks and menu screens: scripts/ensure-nginx-ws.sh'

def skip_to(text, j, n):
    """Past a comment or a quoted string starting at j, else None."""
    c = text[j]
    if c == '#':
        k = text.find('\n', j)
        return n if k < 0 else k
    if c in '"\'':
        k = j + 1
        while k < n and text[k] != c:
            k += 2 if text[k] == '\\' else 1
        return k + 1
    return None

def close_of(text, i):
    """The } that closes the { at i (comments and quoted strings skipped)."""
    depth, j, n = 0, i, len(text)
    while j < n:
        k = skip_to(text, j, n)
        if k is not None:
            j = k
            continue
        if text[j] == '{':
            depth += 1
        elif text[j] == '}':
            depth -= 1
            if depth == 0:
                return j
        j += 1
    return -1

def top_level_locations(text, start, end):
    """(line_start, indent, path, body) of each location directly in a block."""
    out, depth, j = [], 0, start
    while j < end:
        k = skip_to(text, j, end)
        if k is not None:
            j = k
            continue
        c = text[j]
        if c == '{':
            depth += 1
        elif c == '}':
            depth -= 1
        elif depth == 0 and text.startswith('location', j) and (j == start or text[j - 1] in ' \t\n;{}'):
            m = re.match(r'location\s+(?:(=|\^~|~\*?)\s*)?([^\s{]+)\s*\{', text[j:end])
            if m:
                brace = j + m.end() - 1
                close = close_of(text, brace)
                if close < 0:
                    return out
                line_start = text.rfind('\n', 0, j) + 1
                indent = re.match(r'[ \t]*', text[line_start:j]).group(0)
                out.append((line_start, indent, m.group(2), text[brace + 1:close]))
                j = close + 1
                continue
        j += 1
    return out

def api_address(locs):
    """The API address this server block proxies to, without a path."""
    by_path = {}
    for _, _, path, body in locs:
        m = re.search(r'(?m)^[ \t]*proxy_pass[ \t]+([^;]+);', body)
        if m and path not in by_path:
            by_path[path] = m.group(1).strip()
    for path in ['/', '/api/'] + list(by_path):
        target = by_path.get(path)
        if not target or '$' in target:
            continue
        m = re.match(r'(https?://[^/\s]+)', target)
        if m:
            return m.group(1)
    return None

files = []
for entry in sorted(os.listdir(sites)):
    if entry.startswith('macaroonie-domain-'):
        continue
    p = os.path.realpath(os.path.join(sites, entry))
    if os.path.isfile(p) and p not in files:
        files.append(p)

changed = []
for i, path in enumerate(files):
    text = open(path).read()
    inserts = []
    for m in re.finditer(r'(?m)^[ \t]*server[ \t]*\{', text):
        brace = m.end() - 1
        close = close_of(text, brace)
        if close < 0:
            continue
        locs = top_level_locations(text, brace + 1, close)
        if not locs:
            continue
        # A /ws location already (exact, prefix or a pattern naming it): leave it.
        if any(re.match(r'^/ws(?:$|[^\w-])', path) or path.lstrip('^').startswith('/ws') for _, _, path, _ in locs):
            continue
        address = api_address(locs)
        if not address:
            continue
        at, indent = locs[0][0], locs[0][1]
        inner = indent + '  '
        lines = [
            indent + NOTE,
            indent + 'location /ws {',
            inner + 'proxy_pass         ' + address + ';',
            inner + 'proxy_http_version 1.1;',
            inner + 'proxy_set_header   Upgrade $http_upgrade;',
            inner + 'proxy_set_header   Connection "Upgrade";',
            inner + 'proxy_set_header   Host $host;',
            inner + 'proxy_set_header   X-Real-IP $remote_addr;',
            inner + 'proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;',
            inner + 'proxy_set_header   X-Forwarded-Proto $scheme;',
            inner + 'proxy_read_timeout 3600s;',
            inner + 'proxy_send_timeout 3600s;',
            indent + '}',
            '',
        ]
        inserts.append((at, '\n'.join(lines) + '\n'))
    if not inserts:
        continue
    for at, block in sorted(inserts, reverse=True):
        text = text[:at] + block + text[at:]
    shutil.copy2(path, os.path.join(backup, str(i)))
    with open(os.path.join(backup, str(i) + '.path'), 'w') as f:
        f.write(path)
    open(path, 'w').write(text)
    changed.append(path + ' (' + str(len(inserts)) + ')')
print('\n'.join(changed))
PY
)

if [[ -z "$CHANGED" ]]; then
  echo "nginx live connections (/ws) already passed through — skip"
  exit 0
fi

echo "passed live connections (/ws) through in:"
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
