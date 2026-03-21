#!/bin/bash
# =============================================================
# deploy.sh — Deploy code updates (run after initial setup.sh)
# Usage:
#   ./deploy.sh            — deploy both API and admin
#   ./deploy.sh api        — deploy API only
#   ./deploy.sh admin      — deploy admin only
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
  cd "${APP_DIR}/api"
  npm install --production --silent
  # Validate env file exists
  [[ -f .env ]] || die ".env not found at ${APP_DIR}/api/.env"
  # PM2 runs as APP_USER, not root — use sudo -u to talk to the correct daemon
  sudo -u "${APP_USER}" pm2 reload macaroonie-api --update-env 2>/dev/null \
    || sudo -u "${APP_USER}" pm2 start "${APP_DIR}/ecosystem.config.cjs"
  sudo -u "${APP_USER}" pm2 save --force
  log "API deployed and reloaded"
}

deploy_admin() {
  info "Building admin portal…"
  cd "${APP_DIR}/admin"
  [[ -f .env ]] || die ".env not found at ${APP_DIR}/admin/.env"
  npm install --silent
  npm run build
  log "Admin portal built → ${APP_DIR}/admin/dist/"
  # Nginx serves directly from dist/ — no reload needed
}

case "$TARGET" in
  api)   deploy_api   ;;
  admin) deploy_admin ;;
  all)   deploy_api; deploy_admin ;;
  *)     die "Unknown target '$TARGET'. Use: api | admin | all" ;;
esac

echo ""
echo -e "${GREEN}${BOLD}Deploy complete.${NC}"
sudo -u "${APP_USER}" pm2 status
