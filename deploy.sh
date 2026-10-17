#!/bin/bash
# =============================================================
# deploy.sh — Deploy code updates (run after initial setup.sh)
# Usage:
#   ./deploy.sh            — deploy both API and admin
#   ./deploy.sh api        — deploy API only
#   ./deploy.sh admin      — deploy admin only
#   ./deploy.sh pos        — build the till app only (served by the API on pos.)
# =============================================================

set -euo pipefail

APP_USER="ubuntu"
APP_DIR="/home/${APP_USER}/app"
TARGET=${1:-"all"}

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'; BOLD='\033[1m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }
die()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

[[ $EUID -ne 0 ]] && die "Run as root: sudo ./deploy.sh"

deploy_api() {
  info "Deploying API…"
  [[ -f "${APP_DIR}/api/.env" ]] || die ".env not found at ${APP_DIR}/api/.env"
  # Install as APP_USER so node_modules are never root-owned
  sudo -u "${APP_USER}" bash -c "
    cd '${APP_DIR}/api'
    npm install --production --silent
  "
  # SECRETS_KEY seals stored integration keys (migration 179): added to
  # api/.env when missing, never changed once there.
  sudo -u "${APP_USER}" bash "${APP_DIR}/scripts/ensure-secrets-key.sh" "${APP_DIR}/api/.env" \
    || die "Couldn't check SECRETS_KEY in api/.env"
  # Run database migrations (idempotent — applies only new SQL files).
  # Uses DATABASE_URL from api/.env. Skipped with SKIP_MIGRATIONS=1.
  if [[ "${SKIP_MIGRATIONS:-0}" != "1" ]]; then
    info "Running database migrations…"
    sudo -u "${APP_USER}" bash -c "
      cd '${APP_DIR}/api'
      set -a; source .env; set +a
      node scripts/migrate.js
    " || die "Migrations failed — aborting deploy"
  else
    info "Skipping migrations (SKIP_MIGRATIONS=1)"
  fi
  # PM2 runs as APP_USER, not root — use sudo -u to talk to the correct daemon
  sudo -u "${APP_USER}" pm2 reload macaroonie-api --update-env 2>/dev/null \
    || sudo -u "${APP_USER}" pm2 start "${APP_DIR}/ecosystem.config.cjs"
  sudo -u "${APP_USER}" pm2 save --force
  log "API deployed and reloaded"
}

deploy_admin() {
  info "Building admin portal…"
  [[ -f "${APP_DIR}/admin/.env" ]] || die ".env not found at ${APP_DIR}/admin/.env"
  # Build as APP_USER so dist/ files are never owned by root
  sudo -u "${APP_USER}" bash -c "
    cd '${APP_DIR}/admin'
    npm install --silent
    npm run build
  "
  log "Admin portal built → ${APP_DIR}/admin/dist/"
  # Nginx serves directly from dist/ — no reload needed
}

deploy_pos() {
  info "Building the till app…"
  # No .env: tills authenticate as paired devices, not through Auth0.
  sudo -u "${APP_USER}" bash -c "
    cd '${APP_DIR}/pos'
    npm install --silent
    npm run build
  "
  log "Till app built → ${APP_DIR}/pos/dist/ (served by the API on pos.)"
}

case "$TARGET" in
  api)   deploy_api   ;;
  admin) deploy_admin ;;
  pos)   deploy_pos   ;;
  all)   deploy_api; deploy_admin; deploy_pos ;;
  *)     die "Unknown target '$TARGET'. Use: api | admin | pos | all" ;;
esac

echo ""
echo -e "${GREEN}${BOLD}Deploy complete.${NC}"
sudo -u "${APP_USER}" pm2 status
