#!/bin/bash
# =============================================================
# setup.sh — Booking platform setup on Ubuntu 24.04 (Lightsail)
# Run as root on a fresh instance:
#   chmod +x setup.sh && sudo ./setup.sh
# =============================================================

set -euo pipefail

# ── Colour helpers ────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ── Config — edit before running ─────────────────────────────
APP_USER="booking"
APP_DIR="/home/${APP_USER}/app"
DOMAIN=""          # e.g. booking.macaroonie.com  (leave blank to skip SSL)
ADMIN_EMAIL=""     # e.g. you@macaroonie.com      (for Let's Encrypt)

# ── Sanity checks ─────────────────────────────────────────────
[[ $EUID -ne 0 ]] && die "Run as root: sudo ./setup.sh"
[[ $(lsb_release -rs) != "24.04" ]] && warn "Tested on Ubuntu 24.04 — your version may differ"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   Macaroonie — Lightsail Setup     ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════╝${NC}"
echo ""

# ═══════════════════════════════════════════════════════════
# 1. System update
# ═══════════════════════════════════════════════════════════
info "Updating system packages…"
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git unzip build-essential \
  ufw fail2ban logrotate \
  software-properties-common apt-transport-https ca-certificates
log "System updated"

# ═══════════════════════════════════════════════════════════
# 2. Create app user
# ═══════════════════════════════════════════════════════════
info "Creating app user '${APP_USER}'…"
if ! id "$APP_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$APP_USER"
  usermod -aG sudo "$APP_USER"
fi
log "User '${APP_USER}' ready"

# ═══════════════════════════════════════════════════════════
# 3. Node.js 22 (LTS)
# ═══════════════════════════════════════════════════════════
info "Installing Node.js 22…"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - -qq
  apt-get install -y -qq nodejs
fi
node -v | grep -q "v22" || warn "Node version may not be 22 — check with: node -v"
npm install -g pm2 --quiet
log "Node $(node -v) + PM2 installed"

# ═══════════════════════════════════════════════════════════
# 4. PostgreSQL 16
# ═══════════════════════════════════════════════════════════
info "Installing PostgreSQL 16…"
if ! command -v psql &>/dev/null; then
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
  echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] \
    https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" \
    > /etc/apt/sources.list.d/pgdg.list
  apt-get update -qq
  apt-get install -y -qq postgresql-16 postgresql-contrib-16
fi
systemctl enable --now postgresql
log "PostgreSQL 16 installed"

# ═══════════════════════════════════════════════════════════
# 5. Redis 7
# ═══════════════════════════════════════════════════════════
info "Installing Redis 7…"
if ! command -v redis-server &>/dev/null; then
  curl -fsSL https://packages.redis.io/gpg \
    | gpg --dearmor -o /usr/share/keyrings/redis.gpg
  echo "deb [signed-by=/usr/share/keyrings/redis.gpg] \
    https://packages.redis.io/deb $(lsb_release -cs) main" \
    > /etc/apt/sources.list.d/redis.list
  apt-get update -qq
  apt-get install -y -qq redis-server
fi
# Secure Redis — bind to localhost only
sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
sed -i 's/^# requirepass.*/requirepass CHANGE_THIS_REDIS_PASSWORD/' /etc/redis/redis.conf
systemctl enable --now redis-server
log "Redis 7 installed (remember to set Redis password in .env)"

# ═══════════════════════════════════════════════════════════
# 6. Nginx
# ═══════════════════════════════════════════════════════════
info "Installing Nginx…"
apt-get install -y -qq nginx
systemctl enable --now nginx
log "Nginx installed"

# ═══════════════════════════════════════════════════════════
# 7. PostgreSQL — create DB + user + enable extensions
# ═══════════════════════════════════════════════════════════
info "Configuring PostgreSQL…"

# Generate a random strong password
DB_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'macaroonie_user') THEN
    CREATE ROLE macaroonie_user WITH LOGIN PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;

DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_database WHERE datname = 'macaroonie_db') THEN
    CREATE DATABASE macaroonie_db OWNER macaroonie_user;
  END IF;
END
\$\$;

\c macaroonie_db

-- Allow macaroonie_user to use public schema
GRANT USAGE ON SCHEMA public TO macaroonie_user;
GRANT CREATE ON SCHEMA public TO macaroonie_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO macaroonie_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO macaroonie_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO macaroonie_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO macaroonie_user;

-- Extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;  -- for fast text search on guest names/emails
SQL

log "Database 'macaroonie_db' created with user 'macaroonie_user'"

# Save credentials to a temp file the app user can read during setup
cat > /home/${APP_USER}/.db_credentials <<CREDS
DB_PASSWORD=${DB_PASS}
DATABASE_URL=postgresql://macaroonie_user:${DB_PASS}@localhost:5432/macaroonie_db
CREDS
chmod 600 /home/${APP_USER}/.db_credentials
chown ${APP_USER}:${APP_USER} /home/${APP_USER}/.db_credentials

# ═══════════════════════════════════════════════════════════
# 8. App directory structure
# ═══════════════════════════════════════════════════════════
info "Creating app directory structure…"
mkdir -p "${APP_DIR}"/{api,admin,logs,releases}
chown -R ${APP_USER}:${APP_USER} "${APP_DIR}"
log "App directories created at ${APP_DIR}"

# ═══════════════════════════════════════════════════════════
# 9. Nginx config
# ═══════════════════════════════════════════════════════════
info "Writing Nginx config…"

cat > /etc/nginx/sites-available/booking <<NGINX
# ── Rate limiting zones ──────────────────────────────────────
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=widget_limit:10m rate=10r/s;

# ── Upstream ─────────────────────────────────────────────────
upstream booking_api {
  server 127.0.0.1:3000;
  keepalive 32;
}

# ── HTTP → HTTPS redirect (active after SSL setup) ───────────
server {
  listen 80;
  server_name ${DOMAIN:-_};

  # Allow Let's Encrypt challenge
  location /.well-known/acme-challenge/ { root /var/www/html; }

  # Redirect all other traffic to HTTPS (uncomment after SSL)
  # return 301 https://\$host\$request_uri;

  # Temp: serve directly until SSL is set up
  include /etc/nginx/sites-available/booking_proxy.inc;
}

# ── HTTPS (uncomment after certbot) ──────────────────────────
# server {
#   listen 443 ssl http2;
#   server_name ${DOMAIN:-macaroonie.com};
#
#   ssl_certificate     /etc/letsencrypt/live/${DOMAIN:-macaroonie.com}/fullchain.pem;
#   ssl_certificate_key /etc/letsencrypt/live/${DOMAIN:-macaroonie.com}/privkey.pem;
#   include /etc/letsencrypt/options-ssl-nginx.conf;
#   ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
#
#   include /etc/nginx/sites-available/booking_proxy.inc;
# }
NGINX

cat > /etc/nginx/sites-available/booking_proxy.inc <<INC
  # ── Security headers ────────────────────────────────────
  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

  # ── Admin portal (React SPA) ─────────────────────────────
  location / {
    root ${APP_DIR}/admin/dist;
    try_files \$uri \$uri/ /index.html;
    expires 1h;
    add_header Cache-Control "public, max-age=3600";
  }

  # Static assets — long cache
  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
    root ${APP_DIR}/admin/dist;
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
  }

  # ── API (Node.js) ────────────────────────────────────────
  location /api/ {
    limit_req zone=api_limit burst=50 nodelay;
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_cache_bypass \$http_upgrade;
    proxy_read_timeout 60s;
    proxy_buffering    off;
  }

  # ── WebSocket ─────────────────────────────────────────────
  location /ws {
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "Upgrade";
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_read_timeout 3600s;
  }

  # ── Stripe webhook ────────────────────────────────────────
  location /webhooks/ {
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 30s;
  }
INC

ln -sf /etc/nginx/sites-available/booking /etc/nginx/sites-enabled/booking
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
log "Nginx configured"

# ═══════════════════════════════════════════════════════════
# 10. PM2 ecosystem file
# ═══════════════════════════════════════════════════════════
info "Writing PM2 ecosystem config…"

cat > ${APP_DIR}/ecosystem.config.cjs <<PM2
module.exports = {
  apps: [
    {
      name:         'macaroonie-api',
      script:       '${APP_DIR}/api/src/server.js',
      instances:    'max',          // one per CPU core
      exec_mode:    'cluster',
      watch:        false,
      max_memory_restart: '512M',
      env: {
        NODE_ENV:   'production',
        PORT:        3000,
      },
      env_file:     '${APP_DIR}/api/.env',
      error_file:   '${APP_DIR}/logs/api-error.log',
      out_file:     '${APP_DIR}/logs/api-out.log',
      merge_logs:   true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      exp_backoff_restart_delay: 100,
    }
  ]
}
PM2

chown ${APP_USER}:${APP_USER} ${APP_DIR}/ecosystem.config.cjs
log "PM2 ecosystem file written"

# ═══════════════════════════════════════════════════════════
# 11. PM2 startup — survive reboots
# ═══════════════════════════════════════════════════════════
info "Configuring PM2 startup…"
pm2 startup systemd -u ${APP_USER} --hp /home/${APP_USER} | tail -1 | bash || true
log "PM2 startup configured"

# ═══════════════════════════════════════════════════════════
# 12. Firewall (UFW)
# ═══════════════════════════════════════════════════════════
info "Configuring firewall…"
ufw --force reset > /dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
# Port 3000 intentionally NOT opened — API is behind Nginx only
ufw --force enable
log "Firewall: SSH/HTTP/HTTPS open, API port 3000 internal only"

# ═══════════════════════════════════════════════════════════
# 13. Fail2ban
# ═══════════════════════════════════════════════════════════
info "Configuring fail2ban…"
cat > /etc/fail2ban/jail.local <<F2B
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = ssh
logpath = %(sshd_log)s

[nginx-http-auth]
enabled = true

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = %(nginx_error_log)s
maxretry = 10
F2B
systemctl enable --now fail2ban
log "Fail2ban configured"

# ═══════════════════════════════════════════════════════════
# 14. Log rotation
# ═══════════════════════════════════════════════════════════
cat > /etc/logrotate.d/macaroonie-api <<LOGROTATE
${APP_DIR}/logs/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  sharedscripts
  postrotate
    pm2 reloadLogs
  endscript
}
LOGROTATE
log "Log rotation configured (14 days)"

# ═══════════════════════════════════════════════════════════
# 15. .env template
# ═══════════════════════════════════════════════════════════
info "Writing .env template…"
DB_URL=$(grep DATABASE_URL /home/${APP_USER}/.db_credentials | cut -d= -f2-)

cat > ${APP_DIR}/api/.env.example <<ENV
# ── Fill in all values before starting the API ───────────────

# Database (pre-filled from setup)
DATABASE_URL=${DB_URL}

# Redis — update password to match /etc/redis/redis.conf requirepass
REDIS_URL=redis://:CHANGE_THIS_REDIS_PASSWORD@127.0.0.1:6379

# Auth0
AUTH0_DOMAIN=macaroonie.eu.auth0.com
AUTH0_AUDIENCE=https://api.macaroonie.com

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Email (SendGrid)
SENDGRID_API_KEY=SG....
EMAIL_FROM=noreply@macaroonie.com

# Server
NODE_ENV=production
PORT=3000
ENV

cp ${APP_DIR}/api/.env.example ${APP_DIR}/api/.env
chown ${APP_USER}:${APP_USER} ${APP_DIR}/api/.env ${APP_DIR}/api/.env.example
chmod 600 ${APP_DIR}/api/.env
log ".env template written to ${APP_DIR}/api/.env"

# ═══════════════════════════════════════════════════════════
# 16. Certbot (SSL) — only if DOMAIN is set
# ═══════════════════════════════════════════════════════════
if [[ -n "$DOMAIN" && -n "$ADMIN_EMAIL" ]]; then
  info "Installing Certbot for SSL…"
  snap install --classic certbot
  ln -sf /snap/bin/certbot /usr/bin/certbot
  certbot --nginx -d "$DOMAIN" --email "$ADMIN_EMAIL" \
    --agree-tos --non-interactive --redirect
  log "SSL certificate installed for ${DOMAIN}"
else
  warn "DOMAIN not set — skipping SSL. Set it at the top of the script and re-run: certbot --nginx -d macaroonie.com"
fi

# ═══════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
echo ""
echo -e "${BOLD}DB credentials saved to:${NC} /home/${APP_USER}/.db_credentials"
echo -e "${BOLD}App directory:${NC}           ${APP_DIR}/"
echo -e "${BOLD}.env template:${NC}           ${APP_DIR}/api/.env"
echo ""
echo -e "${YELLOW}${BOLD}Next steps:${NC}"
echo "  1. Upload your code to ${APP_DIR}/api/ and ${APP_DIR}/admin/"
echo "  2. Edit ${APP_DIR}/api/.env — fill in Auth0, Stripe, SendGrid values"
echo "  3. Set the Redis password in .env to match /etc/redis/redis.conf"
echo "  4. Run migrations: psql \$DATABASE_URL -f migrations/001_tenants_users.sql ..."
echo "  5. Build admin: cd ${APP_DIR}/admin && npm install && npm run build"
echo "  6. Install API deps: cd ${APP_DIR}/api && npm install --production"
echo "  7. Start API: pm2 start ${APP_DIR}/ecosystem.config.cjs"
echo "  8. Save PM2 state: pm2 save"
echo ""
echo -e "${BOLD}Useful commands:${NC}"
echo "  pm2 status           — check processes"
echo "  pm2 logs macaroonie-api — live logs"
echo "  pm2 restart all      — restart after code update"
echo "  nginx -t             — test nginx config"
echo ""
