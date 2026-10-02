#!/usr/bin/env bash
# Adds office.<domain> (admin portal) and ops.<domain> (the same admin, opened
# on /mobile so the phone app installs as its own app) to nginx, with HTTPS.
#
# Run on the server, as root:
#   sudo DOMAIN=macaroonie.com bash scripts/nginx-office-ops.sh
#
# Writes /etc/nginx/sites-available/macaroonie-office (both hosts), enables it,
# tests and restarts nginx. The script writes the whole file itself, HTTPS
# included; certbot never edits it. The certificate is, in order:
#   1. CERT_NAME=<dir> under /etc/letsencrypt/live, if given;
#   2. an existing certificate covering both names (the *.<domain> wildcard
#      certificate the tenant sites use covers them);
#   3. otherwise a new one from `certbot certonly --webroot` (uses the
#      server's existing certbot account; CERTBOT_EMAIL only if there is none),
#      renewed by certbot's timer, which reloads nginx afterwards.
# Port 80 only answers ACME challenges and redirects to HTTPS. IPv6 listens are
# added when other sites on the server listen on IPv6, so the wildcard tenant
# block can't catch office/ops over IPv6.
#
# DRY_RUN=1 prints the config instead. Safe to run again: it rewrites the same
# file. Does not touch the apex (macaroonie.com) config;
# scripts/nginx-apex-landing.sh does that, later.
set -euo pipefail

DOMAIN="${DOMAIN:-macaroonie.com}"
APP_DIR="${APP_DIR:-/home/ubuntu/app}"
DIST="${APP_DIR}/admin/dist"
CONF="/etc/nginx/sites-available/macaroonie-office"
UPSTREAM="${UPSTREAM:-booking_api}"
LIVE="${LIVE:-/etc/letsencrypt/live}"
OFFICE="office.${DOMAIN}"
OPS="ops.${DOMAIN}"

if [[ -z "${DRY_RUN:-}" ]] && ! grep -rqs "upstream ${UPSTREAM}" /etc/nginx/; then
  echo "nginx upstream '${UPSTREAM}' not found (it is defined in the main macaroonie config). Set UPSTREAM=... and retry." >&2
  exit 1
fi

# IPv6 only if something else already listens there (see header).
IPV6=""
if grep -rqs 'listen \[::\]' /etc/nginx/sites-enabled/ 2>/dev/null; then IPV6=1; fi

# ── Certificate ────────────────────────────────────────────────────────────
# True when the certificate's names include $2 itself or *.<parent of $2>.
cert_covers() {
  local sans
  sans=$(openssl x509 -in "$1" -noout -text 2>/dev/null | grep -A1 'Subject Alternative Name' | tail -1) || return 1
  [[ ", ${sans}," == *"DNS:$2,"* || ", ${sans}," == *"DNS:*.${2#*.},"* ]]
}

find_cert() {
  if [[ -n "${CERT_NAME:-}" ]]; then echo "${LIVE}/${CERT_NAME}"; return 0; fi
  local f
  for f in "${LIVE}"/*/fullchain.pem; do
    [[ -f "$f" ]] || continue
    if cert_covers "$f" "$OFFICE" && cert_covers "$f" "$OPS"; then
      dirname "$f"
      return 0
    fi
  done
  return 1
}

# ── Config ─────────────────────────────────────────────────────────────────
# Guest and public paths the API serves on every host. ^~ so the static-file
# regex below can't catch them (an /uploads/x.png would otherwise be looked
# for in admin/dist).
PROXIES=""
for p in /manage /reservations /widget-api /order-api /uploads/ /template-assets/; do
  PROXIES+="
  location ^~ ${p} {
    limit_req zone=widget_limit burst=20 nodelay;
    proxy_pass         http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
    proxy_buffering    off;
  }"
done

# The locations both hosts serve (same as the apex admin config in setup.sh).
site_locations() {
  local extra="$1"
  cat <<NGINX
  client_max_body_size 30M;

  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
${extra}
  location / {
    root ${DIST};
    try_files \$uri \$uri/ /index.html;
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires off;
  }

  location ~* (?:^|/)(sw\\.js|registerSW\\.js|workbox-.*\\.js|.*\\.webmanifest)\$ {
    root ${DIST};
    add_header Cache-Control "no-cache, no-store, must-revalidate";
    expires off;
    etag on;
  }

  location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)\$ {
    root ${DIST};
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
  }

  location /api/ {
    limit_req zone=api_limit burst=50 nodelay;
    proxy_pass         http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
    proxy_buffering    off;
  }
${PROXIES}
  location /ws {
    proxy_pass         http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "Upgrade";
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_read_timeout 3600s;
  }

  location /webhooks/ {
    proxy_pass         http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_read_timeout 30s;
  }
NGINX
}

listen80() { echo "  listen 80;"; [[ -n "$IPV6" ]] && echo "  listen [::]:80;"; return 0; }

# HTTP only: serves the site on port 80. Used just long enough for certbot's
# webroot challenge when there is no certificate yet.
http_block() {
  local host="$1" extra="$2"
  echo "server {"
  listen80
  echo "  server_name ${host};"
  echo "  location /.well-known/acme-challenge/ { root /var/www/html; }"
  site_locations "$extra"
  echo "}"
  echo
}

# HTTPS: port 80 redirects, port 443 serves the site.
https_blocks() {
  local host="$1" extra="$2" dir="$3"
  echo "server {"
  listen80
  echo "  server_name ${host};"
  echo "  location /.well-known/acme-challenge/ { root /var/www/html; }"
  echo "  location / { return 301 https://\$host\$request_uri; }"
  echo "}"
  echo
  echo "server {"
  echo "  listen 443 ssl http2;"
  [[ -n "$IPV6" ]] && echo "  listen [::]:443 ssl http2;"
  echo "  server_name ${host};"
  echo "  ssl_certificate     ${dir}/fullchain.pem;"
  echo "  ssl_certificate_key ${dir}/privkey.pem;"
  [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]] && echo "  include /etc/letsencrypt/options-ssl-nginx.conf;"
  [[ -f /etc/letsencrypt/ssl-dhparams.pem ]] && echo "  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  site_locations "$extra"
  echo "}"
  echo
}

# ops: the bare address opens the phone app (query kept for the Auth0 callback).
OPS_EXTRA='
  location = / { return 302 /mobile/$is_args$args; }
'

render() {
  local dir="${1:-}"
  echo "# ${OFFICE} (admin) and ${OPS} (phone app). Written by scripts/nginx-office-ops.sh; edits are overwritten."
  if [[ -n "$dir" ]]; then
    https_blocks "$OFFICE" "" "$dir"
    https_blocks "$OPS" "$OPS_EXTRA" "$dir"
  else
    http_block "$OFFICE" ""
    http_block "$OPS" "$OPS_EXTRA"
  fi
}

apply() {
  render "${1:-}" > "$CONF"
  ln -sf "$CONF" /etc/nginx/sites-enabled/macaroonie-office
  if ! nginx -t; then
    echo "nginx -t failed with the new ${CONF}; disabling it" >&2
    rm -f /etc/nginx/sites-enabled/macaroonie-office
    exit 1
  fi
  systemctl restart nginx
}

if [[ -n "${CERT_NAME:-}" && -z "${DRY_RUN:-}" && ! -f "${LIVE}/${CERT_NAME}/fullchain.pem" ]]; then
  echo "CERT_NAME=${CERT_NAME}: ${LIVE}/${CERT_NAME}/fullchain.pem not found" >&2
  exit 1
fi

if [[ -n "${DRY_RUN:-}" ]]; then
  CERT_DIR=$(find_cert || true)
  render "${CERT_DIR:-${LIVE}/${OFFICE}}"
  exit 0
fi

CERT_DIR=$(find_cert || true)
if [[ -z "$CERT_DIR" ]]; then
  echo "No certificate covers ${OFFICE} and ${OPS}; asking certbot for one (webroot)."
  apply ""
  mkdir -p /var/www/html
  EMAIL_ARGS=()
  [[ -n "${CERTBOT_EMAIL:-}" ]] && EMAIL_ARGS=(--email "$CERTBOT_EMAIL")
  certbot certonly --webroot -w /var/www/html -d "$OFFICE" -d "$OPS" \
    --cert-name "$OFFICE" --agree-tos --non-interactive "${EMAIL_ARGS[@]}" \
    --deploy-hook "systemctl reload nginx"
  CERT_DIR="${LIVE}/${OFFICE}"
fi

echo "Using certificate ${CERT_DIR}"
apply "$CERT_DIR"
echo "nginx: https://${OFFICE} and https://${OPS} enabled"
