#!/usr/bin/env bash
# Switches on a tenant's custom domain on this server: an nginx server block
# that sends the domain to the API (which renders the tenant's site) and an
# HTTPS certificate for it.
#
# Normally run for you: scripts/custom-domains-sync.sh (installed by every
# deploy as a systemd timer) calls the installed copy of this script,
# /usr/local/sbin/macaroonie-domain, within a minute of the tenant pressing
# Verify DNS, and removes domains nobody has saved any more. Run it by hand to
# add a name the sync doesn't (e.g. a www twin whose DNS appeared later), or
# with the sync switched off.
#
# By hand, on the server, as root, after the tenant has saved the domain in
# Website > Domain, pointed its DNS at us and pressed Verify DNS:
#   sudo bash scripts/nginx-custom-domain.sh onethai.com
#   sudo bash scripts/nginx-custom-domain.sh www.onethai.com onethai.com
# The first name is the site's address, exactly as saved in Website > Domain.
# Any further names (the www / bare version) redirect to it; their DNS must
# point here too.
#
# Writes /etc/nginx/sites-available/macaroonie-domain-<first name>, enables it,
# tests and restarts nginx. The script writes the whole file; certbot never
# edits it. Steps:
#   1. HTTP only, so certbot's webroot challenge can be answered;
#   2. `certbot certonly --webroot` for every name (skipped when a certificate
#      under /etc/letsencrypt/live already covers them, or CERT_NAME=<dir>);
#   3. port 80 redirects to HTTPS, port 443 serves the site.
# If the certificate fails (DNS not pointing here yet, Cloudflare orange
# cloud), the HTTP block stays on so the site works on http:// and the script
# says why; run it again once DNS is right. Renewal is certbot's timer, which
# reloads nginx afterwards.
#
# Without a block like this, a request for the domain falls to nginx's default
# server for the port (on this server, certbot's `return 404` block for the
# apex), so the guest gets a bare 404 whatever the app knows about the domain.
#
# REMOVE=1 takes the domain off (DELETE_CERT=1 also deletes its certificate).
# DRY_RUN=1 prints the config instead. Safe to run again: it rewrites the same
# file. One run at a time (a lock), so a hand run and the sync don't interleave.
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: sudo bash scripts/nginx-custom-domain.sh <domain> [redirect-from ...]" >&2
  exit 1
fi

# Lower case, no scheme, no path, no trailing dot.
clean() { local h="${1,,}"; h="${h#http://}"; h="${h#https://}"; h="${h%%/*}"; echo "${h%.}"; }

MAIN=$(clean "$1"); shift
ALIASES=()
for a in "$@"; do ALIASES+=("$(clean "$a")"); done
NAMES=("$MAIN" "${ALIASES[@]}")

HOST_RE='^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$'
for n in "${NAMES[@]}"; do
  if [[ ! "$n" =~ $HOST_RE ]]; then echo "Not a domain name: ${n}" >&2; exit 1; fi
done

APP_DIR="${APP_DIR:-/home/ubuntu/app}"
UPSTREAM="${UPSTREAM:-booking_api}"
LIVE="${LIVE:-/etc/letsencrypt/live}"
CONF="/etc/nginx/sites-available/macaroonie-domain-${MAIN}"
LINK="/etc/nginx/sites-enabled/macaroonie-domain-${MAIN}"

# Children get `9>&-` so nothing they leave running (nginx, when started
# directly) keeps holding the lock.
if [[ -z "${DRY_RUN:-}" ]]; then
  exec 9>"${LOCK_DIR:-/run/lock}/macaroonie-domain.lock"
  flock -w 600 9 || { echo "Another run of this script is still going; try again in a minute." >&2; exit 1; }
fi

if [[ -n "${REMOVE:-}" ]]; then
  rm -f "$LINK" "$CONF"
  nginx -t && systemctl restart nginx 9>&-
  if [[ -n "${DELETE_CERT:-}" && -d "${LIVE}/${MAIN}" ]]; then
    certbot delete --cert-name "$MAIN" --non-interactive 9>&- || echo "certbot couldn't delete the certificate ${MAIN}" >&2
    echo "nginx: ${MAIN} removed, with its certificate."
  else
    echo "nginx: ${MAIN} removed. The certificate is left in ${LIVE}; delete it with: certbot delete --cert-name ${MAIN}"
  fi
  exit 0
fi

if [[ -z "${DRY_RUN:-}" ]] && ! grep -rqs "upstream ${UPSTREAM}" /etc/nginx/; then
  echo "nginx upstream '${UPSTREAM}' not found (it is defined in the main macaroonie config). Set UPSTREAM=... and retry." >&2
  exit 1
fi

# ── Does the app know this domain? ─────────────────────────────────────────
# Only a warning: the block works once the domain is saved, verified and the
# site published, in any order.
check_app() {
  local env_file="${APP_DIR}/api/.env" db row
  command -v psql >/dev/null 2>&1 || return 0
  [[ -f "$env_file" ]] || return 0
  db=$(grep -E '^DATABASE_URL=' "$env_file" | head -1 | cut -d= -f2- | tr -d '"'"'") || return 0
  [[ -n "$db" ]] || return 0
  # System mode: tenant_site has forced row-level security (migration 176).
  row=$(PGOPTIONS="-c app.bypass_rls=on" psql "$db" -tA -F'|' -c "SELECT custom_domain_verified, is_published FROM tenant_site WHERE lower(custom_domain) = lower('${MAIN}')" 2>/dev/null) || return 0
  if [[ -z "$row" ]]; then
    echo "Note: no tenant has ${MAIN} saved in Website > Domain, so the app will answer 'Site not found'."
    echo "      Save exactly ${MAIN} there (the other names here only redirect to it)."
  else
    [[ "${row%%|*}" == "t" ]] || echo "Note: ${MAIN} is saved but not verified. Press Verify DNS in Website > Domain."
    [[ "${row##*|}" == "t" ]] || echo "Note: the site is not live yet. Switch on 'Site is live' in Website > Domain."
  fi
}

# IPv6 only if something else already listens there, so the wildcard tenant
# block can't catch the domain over IPv6.
IPV6=""
if grep -rqs 'listen \[::\]' /etc/nginx/sites-enabled/ 2>/dev/null; then IPV6=1; fi

# ── Certificate ────────────────────────────────────────────────────────────
cert_covers() {
  local sans
  sans=$(openssl x509 -in "$1" -noout -text 2>/dev/null | grep -A1 'Subject Alternative Name' | tail -1) || return 1
  [[ ", ${sans}," == *"DNS:$2,"* ]]
}

find_cert() {
  if [[ -n "${CERT_NAME:-}" ]]; then echo "${LIVE}/${CERT_NAME}"; return 0; fi
  local f n ok
  for f in "${LIVE}"/*/fullchain.pem; do
    [[ -f "$f" ]] || continue
    ok=1
    for n in "${NAMES[@]}"; do cert_covers "$f" "$n" || { ok=""; break; }; done
    if [[ -n "$ok" ]]; then dirname "$f"; return 0; fi
  done
  return 1
}

# A certificate for the main name alone (an earlier run's). It keeps
# https://MAIN on while a certificate for added names is requested, and after
# that fails.
find_main_cert() {
  local f
  for f in "${LIVE}"/*/fullchain.pem; do
    [[ -f "$f" ]] || continue
    if cert_covers "$f" "$MAIN"; then dirname "$f"; return 0; fi
  done
  return 1
}

# ── Config ─────────────────────────────────────────────────────────────────
listen80() { echo "  listen 80;"; [[ -n "$IPV6" ]] && echo "  listen [::]:80;"; return 0; }
listen443() { echo "  listen 443 ssl http2;"; [[ -n "$IPV6" ]] && echo "  listen [::]:443 ssl http2;"; return 0; }

ssl_lines() {
  echo "  ssl_certificate     $1/fullchain.pem;"
  echo "  ssl_certificate_key $1/privkey.pem;"
  [[ -f /etc/letsencrypt/options-ssl-nginx.conf ]] && echo "  include /etc/letsencrypt/options-ssl-nginx.conf;"
  [[ -f /etc/letsencrypt/ssl-dhparams.pem ]] && echo "  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;"
  return 0
}

# Everything goes to the API: the site, its pages, the booking widget,
# ordering, uploads and the guest manage page all render there by Host.
site_locations() {
  cat <<NGINX
  client_max_body_size 30M;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location / {
    proxy_pass         http://${UPSTREAM};
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
    proxy_buffering    off;
  }
NGINX
}

acme() { echo "  location /.well-known/acme-challenge/ { root /var/www/html; }"; }

render() {
  local dir="${1:-}" a
  echo "# Custom domain ${MAIN}${ALIASES[*]:+ (+ ${ALIASES[*]})}. Written by scripts/nginx-custom-domain.sh; edits are overwritten."
  if [[ -z "$dir" ]]; then
    # HTTP only, until there is a certificate.
    echo "server {"; listen80; echo "  server_name ${MAIN};"; acme; site_locations; echo "}"; echo
    for a in "${ALIASES[@]}"; do
      echo "server {"; listen80; echo "  server_name ${a};"; acme
      echo "  location / { return 301 http://${MAIN}\$request_uri; }"; echo "}"; echo
    done
    return
  fi
  echo "server {"; listen80; echo "  server_name ${NAMES[*]};"; acme
  echo "  location / { return 301 https://${MAIN}\$request_uri; }"; echo "}"; echo
  echo "server {"; listen443; echo "  server_name ${MAIN};"; ssl_lines "$dir"; site_locations; echo "}"; echo
  for a in "${ALIASES[@]}"; do
    echo "server {"; listen443; echo "  server_name ${a};"; ssl_lines "$dir"
    echo "  location / { return 301 https://${MAIN}\$request_uri; }"; echo "}"; echo
  done
}

apply() {
  render "${1:-}" > "$CONF"
  ln -sf "$CONF" "$LINK"
  if ! nginx -t; then
    echo "nginx -t failed with the new ${CONF}; disabling it" >&2
    rm -f "$LINK"
    exit 1
  fi
  systemctl restart nginx 9>&-
}

if [[ -n "${CERT_NAME:-}" && -z "${DRY_RUN:-}" && ! -f "${LIVE}/${CERT_NAME}/fullchain.pem" ]]; then
  echo "CERT_NAME=${CERT_NAME}: ${LIVE}/${CERT_NAME}/fullchain.pem not found" >&2
  exit 1
fi

if [[ -n "${DRY_RUN:-}" ]]; then
  CERT_DIR=$(find_cert 2>/dev/null || true)
  render "${CERT_DIR:-${LIVE}/${MAIN}}"
  exit 0
fi

check_app

CERT_DIR=$(find_cert || true)
if [[ -z "$CERT_DIR" ]]; then
  PREV_DIR=$(find_main_cert || true)
  if [[ -n "$PREV_DIR" ]]; then
    # Port 80 answers the challenge for every name; https://MAIN stays on.
    echo "No certificate covers ${NAMES[*]}; asking certbot for one (webroot), keeping https://${MAIN} on meanwhile."
    apply "$PREV_DIR"
  else
    echo "No certificate covers ${NAMES[*]}; asking certbot for one (webroot)."
    apply ""
  fi
  mkdir -p /var/www/html
  CERT_ARGS=()
  for n in "${NAMES[@]}"; do CERT_ARGS+=(-d "$n"); done
  EMAIL_ARGS=()
  [[ -n "${CERTBOT_EMAIL:-}" ]] && EMAIL_ARGS=(--email "$CERTBOT_EMAIL")
  if ! certbot certonly --webroot -w /var/www/html "${CERT_ARGS[@]}" \
       --cert-name "$MAIN" --agree-tos --non-interactive "${EMAIL_ARGS[@]}" \
       --deploy-hook "systemctl reload nginx" 9>&-; then
    echo >&2
    if [[ -n "$PREV_DIR" ]]; then
      KEEP=() NEW=()
      for a in "${ALIASES[@]}"; do
        if cert_covers "${PREV_DIR}/fullchain.pem" "$a"; then KEEP+=("$a"); else NEW+=("$a"); fi
      done
      ALIASES=("${KEEP[@]}"); NAMES=("$MAIN" "${ALIASES[@]}")
      apply "$PREV_DIR"
      echo "https://${MAIN} stays on as before; ${NEW[*]} couldn't get a certificate yet." >&2
      echo "Usual causes: its DNS record doesn't point at this server yet, or Cloudflare's proxy is on. Run this again once fixed." >&2
      exit 1
    fi
    echo "No certificate yet, so ${MAIN} works on http:// only for now." >&2
    echo "Usual causes: the DNS record doesn't point at this server yet (check with: dig +short ${MAIN}),"   >&2
    echo "or Cloudflare's proxy is on (orange cloud; it must be DNS only). Run this script again once fixed." >&2
    exit 1
  fi
  CERT_DIR="${LIVE}/${MAIN}"
fi

echo "Using certificate ${CERT_DIR}"
apply "$CERT_DIR"
echo "nginx: https://${MAIN} enabled${ALIASES[*]:+ (${ALIASES[*]} redirect to it)}"
