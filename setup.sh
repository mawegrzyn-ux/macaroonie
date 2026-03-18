#!/bin/bash
# =============================================================
# setup.sh — Macaroonie setup on Ubuntu 24.04 (Lightsail)
# Run once on a fresh instance as the ubuntu user:
#   chmod +x setup.sh && sudo ./setup.sh
# =============================================================

set -euo pipefail

# ── Config — edit before running ─────────────────────────────
APP_DIR="/home/ubuntu/app"
DOMAIN="macaroonie.com"
ADMIN_EMAIL="mawegrzyn@gmail.com"

# ── Colour helpers ────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo ./setup.sh"
[[ $(lsb_release -rs) != "24.04" ]] && warn "Tested on Ubuntu 24.04 — your version may differ"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     Macaroonie — Lightsail Setup         ║${NC}"
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
# 2. Node.js 22
# ═══════════════════════════════════════════════════════════
info "Installing Node.js 22…"
if ! command -v node &>/dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y -qq nodejs
fi
node -v | grep -q "v22" || warn "Node version may not be 22 — check: node -v"
npm install -g pm2 --quiet
log "Node $(node -v) + PM2 installed"

# ═══════════════════════════════════════════════════════════
# 3. PostgreSQL 16
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
# 4. Redis 7
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
sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf
sed -i 's/^# requirepass.*/requirepass sd94mr95fmsdkDH84DN2dj40wlo47G4Y/' /etc/redis/redis.conf
systemctl enable --now redis-server
log "Redis 7 installed (set Redis password in .env)"

# ═══════════════════════════════════════════════════════════
# 5. Nginx
# ═══════════════════════════════════════════════════════════
info "Installing Nginx…"
apt-get install -y -qq nginx
systemctl enable --now nginx
log "Nginx installed"

# ═══════════════════════════════════════════════════════════
# 6. PostgreSQL — create DB + user
# ═══════════════════════════════════════════════════════════
info "Configuring PostgreSQL…"
DB_PASS=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 32)

sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'macaroonie_user') THEN
    CREATE ROLE macaroonie_user WITH LOGIN PASSWORD '${DB_PASS}';
  ELSE
    ALTER ROLE macaroonie_user WITH PASSWORD '${DB_PASS}';
  END IF;
END
\$\$;
SQL

# CREATE DATABASE must run outside a DO block
sudo -u postgres psql -v ON_ERROR_STOP=1 <<SQL
SELECT 'CREATE DATABASE macaroonie_db OWNER macaroonie_user'
 WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'macaroonie_db')\gexec
SQL

sudo -u postgres psql -v ON_ERROR_STOP=1 -d macaroonie_db <<SQL
GRANT USAGE  ON SCHEMA public TO macaroonie_user;
GRANT CREATE ON SCHEMA public TO macaroonie_user;
GRANT ALL PRIVILEGES ON ALL TABLES    IN SCHEMA public TO macaroonie_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO macaroonie_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO macaroonie_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO macaroonie_user;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

DB_URL="postgresql://macaroonie_user:${DB_PASS}@localhost:5432/macaroonie_db"
log "Database ready — URL saved to ${APP_DIR}/api/.env"

# ═══════════════════════════════════════════════════════════
# 7. App directory — owned by ubuntu, no second user
# ═══════════════════════════════════════════════════════════
info "Cloning repo…"
if [ ! -d "${APP_DIR}/.git" ]; then
  rm -rf "${APP_DIR}"
  sudo -u ubuntu git clone https://github.com/mawegrzyn-ux/Macaroonie.git "${APP_DIR}"
else
  sudo -u ubuntu git -C "${APP_DIR}" pull origin main
fi
mkdir -p "${APP_DIR}/logs"
chown -R ubuntu:ubuntu "${APP_DIR}"
log "App directory ready: ${APP_DIR}"

# ═══════════════════════════════════════════════════════════
# 9. .env file
# ═══════════════════════════════════════════════════════════
info "Writing .env…"
cat > "${APP_DIR}/api/.env" <<ENV
# ── Fill in Stripe + SendGrid values then restart PM2 ────────
NODE_ENV=production
PORT=3000

DATABASE_URL=${DB_URL}

REDIS_URL=redis://:sd94mr95fmsdkDH84DN2dj40wlo47G4Y@127.0.0.1:6379

AUTH0_DOMAIN=obscurekitty.uk.auth0.com
AUTH0_AUDIENCE=https://api.macaroonie.com

STRIPE_SECRET_KEY=sk_live_REPLACEME
STRIPE_WEBHOOK_SECRET=whsec_REPLACEME

SENDGRID_API_KEY=SG.REPLACEME
EMAIL_FROM=noreply@macaroonie.com
ENV
chown ubuntu:ubuntu "${APP_DIR}/api/.env"
chmod 600 "${APP_DIR}/api/.env"
log ".env written — fill in Stripe + SendGrid values before starting"

# ═══════════════════════════════════════════════════════════
# 10. Install dependencies + build admin
# ═══════════════════════════════════════════════════════════
info "Installing API dependencies…"
sudo -u ubuntu bash -c "cd ${APP_DIR}/api && npm install --production --silent"
log "API deps installed"

info "Building admin portal…"
# Write admin .env
cat > "${APP_DIR}/admin/.env" <<ADMINENV
VITE_AUTH0_DOMAIN=obscurekitty.uk.auth0.com
VITE_AUTH0_CLIENT_ID=REPLACEME
VITE_AUTH0_AUDIENCE=https://api.macaroonie.com
ADMINENV
chown ubuntu:ubuntu "${APP_DIR}/admin/.env"
sudo -u ubuntu bash -c "cd ${APP_DIR}/admin && npm install --silent && npm run build"
log "Admin portal built"

# ═══════════════════════════════════════════════════════════
# 11. Run migrations
# ═══════════════════════════════════════════════════════════
info "Running database migrations…"
for f in "${APP_DIR}"/migrations/00*.sql; do
  echo "  → $(basename $f)"
  sudo -u ubuntu psql "${DB_URL}" -f "$f" -q
done
log "Migrations complete"

# ═══════════════════════════════════════════════════════════
# 12. PM2 ecosystem
# ═══════════════════════════════════════════════════════════
info "Writing PM2 ecosystem…"
cat > "${APP_DIR}/ecosystem.config.cjs" <<PM2
module.exports = {
  apps: [{
    name:               'macaroonie-api',
    script:             '${APP_DIR}/api/src/server.js',
    instances:          'max',
    exec_mode:          'cluster',
    watch:              false,
    max_memory_restart: '512M',
    interpreter_args:   '--import ${APP_DIR}/api/src/preload.js',
    env: {
      NODE_ENV: 'production',
      PORT:     3000,
    },
    error_file:      '${APP_DIR}/logs/api-error.log',
    out_file:        '${APP_DIR}/logs/api-out.log',
    merge_logs:      true,
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    exp_backoff_restart_delay: 100,
  }]
}
PM2
chown ubuntu:ubuntu "${APP_DIR}/ecosystem.config.cjs"
log "PM2 ecosystem written"

# ═══════════════════════════════════════════════════════════
# 13. Start API
# ═══════════════════════════════════════════════════════════
info "Starting API with PM2…"
sudo -u ubuntu bash -c "cd ${APP_DIR} && pm2 start ecosystem.config.cjs && pm2 save"

# PM2 startup — survive reboots
sudo -u ubuntu pm2 startup systemd -u ubuntu --hp /home/ubuntu | tail -1 | bash || true
log "PM2 started and configured for reboot"

# ═══════════════════════════════════════════════════════════
# 14. Nginx config
# ═══════════════════════════════════════════════════════════
info "Writing Nginx config…"
cat > /etc/nginx/sites-available/macaroonie <<NGINX
limit_req_zone \$binary_remote_addr zone=api_limit:10m    rate=30r/s;
limit_req_zone \$binary_remote_addr zone=widget_limit:10m rate=10r/s;

upstream booking_api {
  server 127.0.0.1:3000;
  keepalive 32;
}

server {
  listen 80;
  server_name ${DOMAIN};

  location /.well-known/acme-challenge/ { root /var/www/html; }
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  include /etc/letsencrypt/options-ssl-nginx.conf;
  ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

  add_header X-Frame-Options "SAMEORIGIN" always;
  add_header X-Content-Type-Options "nosniff" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;

  location / {
    root ${APP_DIR}/admin/dist;
    try_files \$uri \$uri/ /index.html;
    expires 1h;
  }

  location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2)$ {
    root ${APP_DIR}/admin/dist;
    expires 1y;
    add_header Cache-Control "public, immutable";
    access_log off;
  }

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
    proxy_read_timeout 60s;
    proxy_buffering    off;
  }

  location /ws {
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "Upgrade";
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_read_timeout 3600s;
  }

  location /webhooks/ {
    proxy_pass         http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_read_timeout 30s;
  }
}
NGINX

ln -sf /etc/nginx/sites-available/macaroonie /etc/nginx/sites-enabled/macaroonie
rm -f /etc/nginx/sites-enabled/default

# ═══════════════════════════════════════════════════════════
# 15. SSL — certbot
# ═══════════════════════════════════════════════════════════
info "Installing SSL certificate…"
snap install --classic certbot 2>/dev/null || true
ln -sf /snap/bin/certbot /usr/bin/certbot 2>/dev/null || true

if [[ -n "$ADMIN_EMAIL" ]]; then
  # Temporarily serve HTTP for the ACME challenge before enabling HTTPS config
  cat > /etc/nginx/sites-available/macaroonie-temp <<TMPNGINX
server {
  listen 80;
  server_name ${DOMAIN};
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / { proxy_pass http://booking_api; }
}
TMPNGINX
  ln -sf /etc/nginx/sites-available/macaroonie-temp /etc/nginx/sites-enabled/macaroonie
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "$DOMAIN" \
    --email "$ADMIN_EMAIL" --agree-tos --non-interactive
  # Now switch to full HTTPS config
  ln -sf /etc/nginx/sites-available/macaroonie /etc/nginx/sites-enabled/macaroonie
  rm -f /etc/nginx/sites-available/macaroonie-temp
  nginx -t && systemctl reload nginx
  log "SSL certificate installed"
else
  # No email — serve HTTP only until you run certbot manually
  cat > /etc/nginx/sites-available/macaroonie-http <<HTTPNGINX
limit_req_zone \$binary_remote_addr zone=api_limit:10m rate=30r/s;
upstream booking_api { server 127.0.0.1:3000; keepalive 32; }
server {
  listen 80;
  server_name ${DOMAIN};
  location /.well-known/acme-challenge/ { root /var/www/html; }
  location / {
    root ${APP_DIR}/admin/dist;
    try_files \$uri \$uri/ /index.html;
  }
  location /api/ {
    limit_req zone=api_limit burst=50 nodelay;
    proxy_pass http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
  }
  location /ws {
    proxy_pass http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "Upgrade";
    proxy_read_timeout 3600s;
  }
  location /webhooks/ {
    proxy_pass http://booking_api;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_read_timeout 30s;
  }
}
HTTPNGINX
  ln -sf /etc/nginx/sites-available/macaroonie-http /etc/nginx/sites-enabled/macaroonie
  nginx -t && systemctl reload nginx
  warn "ADMIN_EMAIL not set — running HTTP only. To add SSL later:"
  warn "  certbot --nginx -d ${DOMAIN} --email you@example.com --agree-tos"
fi

# ═══════════════════════════════════════════════════════════
# 16. Firewall
# ═══════════════════════════════════════════════════════════
info "Configuring firewall…"
ufw --force reset > /dev/null
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp   comment 'SSH'
ufw allow 80/tcp   comment 'HTTP'
ufw allow 443/tcp  comment 'HTTPS'
ufw --force enable
log "Firewall: SSH/HTTP/HTTPS open — port 3000 internal only"

# ═══════════════════════════════════════════════════════════
# 17. Fail2ban
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

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = %(nginx_error_log)s
maxretry = 10
F2B
systemctl enable --now fail2ban
log "Fail2ban configured"

# ═══════════════════════════════════════════════════════════
# 18. Log rotation
# ═══════════════════════════════════════════════════════════
cat > /etc/logrotate.d/macaroonie <<LOGROTATE
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
log "Log rotation configured"

# ═══════════════════════════════════════════════════════════
# Done
# ═══════════════════════════════════════════════════════════
echo ""
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
echo -e "${GREEN}${BOLD}  Setup complete!${NC}"
echo -e "${GREEN}${BOLD}═══════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}${BOLD}Before the API will fully start, fill in:${NC}"
echo "  nano ${APP_DIR}/api/.env"
echo "  → STRIPE_SECRET_KEY"
echo "  → STRIPE_WEBHOOK_SECRET"
echo "  → REDIS_URL password (match /etc/redis/redis.conf requirepass)"
echo "  → VITE_AUTH0_CLIENT_ID in ${APP_DIR}/admin/.env then rebuild:"
echo "    cd ${APP_DIR}/admin && npm run build"
echo ""
echo -e "${BOLD}Then restart:${NC}"
echo "  pm2 restart macaroonie-api"
echo ""
echo -e "${BOLD}Useful commands:${NC}"
echo "  pm2 status"
echo "  pm2 logs macaroonie-api"
echo "  pm2 restart macaroonie-api"
echo "  curl http://localhost:3000/api/health"
echo ""
