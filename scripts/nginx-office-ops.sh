#!/usr/bin/env bash
# Adds office.<domain> (admin portal) and ops.<domain> (the same admin, opened
# on /mobile so the phone app installs as its own app) to nginx.
#
# Run once on the server, as root:
#   sudo DOMAIN=macaroonie.com CERTBOT_EMAIL=you@example.com bash scripts/nginx-office-ops.sh
#
# Writes /etc/nginx/sites-available/macaroonie-office (both hosts), enables it,
# tests and restarts nginx, then asks certbot for a certificate for both names
# (skipped without CERTBOT_EMAIL; a wildcard *.<domain> certificate also covers
# them). DRY_RUN=1 prints the config instead. Safe to run again: it rewrites
# the same file. Does not touch the apex
# (macaroonie.com) config; scripts/nginx-apex-landing.sh does that, later.
set -euo pipefail

DOMAIN="${DOMAIN:-macaroonie.com}"
APP_DIR="${APP_DIR:-/home/ubuntu/app}"
DIST="${APP_DIR}/admin/dist"
CONF="/etc/nginx/sites-available/macaroonie-office"
UPSTREAM="${UPSTREAM:-booking_api}"

if [[ -z "${DRY_RUN:-}" ]] && ! grep -rqs "upstream ${UPSTREAM}" /etc/nginx/; then
  echo "nginx upstream '${UPSTREAM}' not found (it is defined in the main macaroonie config). Set UPSTREAM=... and retry." >&2
  exit 1
fi

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

# Same locations as the apex admin config (setup.sh), for one host.
server_block() {
  local host="$1" extra="$2"
  cat <<NGINX
server {
  listen 80;
  server_name ${host};
  client_max_body_size 30M;

  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location /.well-known/acme-challenge/ { root /var/www/html; }
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
}

NGINX
}

# ops: the bare address opens the phone app (query kept for the Auth0 callback).
OPS_EXTRA='
  location = / { return 302 /mobile/$is_args$args; }
'

render() {
  echo "# office.${DOMAIN} (admin) and ops.${DOMAIN} (phone app). Written by scripts/nginx-office-ops.sh."
  server_block "office.${DOMAIN}" ""
  server_block "ops.${DOMAIN}" "${OPS_EXTRA}"
}

if [[ -n "${DRY_RUN:-}" ]]; then
  render
  exit 0
fi
render > "$CONF"

ln -sf "$CONF" /etc/nginx/sites-enabled/macaroonie-office
nginx -t
systemctl restart nginx
echo "nginx: office.${DOMAIN} and ops.${DOMAIN} enabled (HTTP)"

if [[ -n "${CERTBOT_EMAIL:-}" ]]; then
  certbot --nginx -d "office.${DOMAIN}" -d "ops.${DOMAIN}" \
    --email "$CERTBOT_EMAIL" --agree-tos --non-interactive --redirect
  systemctl restart nginx
  echo "HTTPS enabled for office.${DOMAIN} and ops.${DOMAIN}"
else
  echo "No CERTBOT_EMAIL: skipped HTTPS. Run:"
  echo "  sudo certbot --nginx -d office.${DOMAIN} -d ops.${DOMAIN} --redirect"
fi
