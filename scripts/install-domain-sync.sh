#!/usr/bin/env bash
# Installs (or updates) the custom domain sync on this server. Run by every
# deploy (.github/workflows/deploy.yml); safe to run again.
#
#   /usr/local/sbin/macaroonie-domain        copy of scripts/nginx-custom-domain.sh
#   /usr/local/sbin/macaroonie-domains-sync  copy of scripts/custom-domains-sync.sh
#   /var/lib/macaroonie-domains/             state the API reads (Domain section)
#   macaroonie-domains.service               one sync run
#   macaroonie-domains.timer                 every minute
#   macaroonie-domains.path                  straight away when the API writes
#                                            /var/lib/macaroonie-domains/kick
#
# Root-owned copies, so the timer never runs a file the app user can edit.
# Switch the sync off with: sudo touch /var/lib/macaroonie-domains/disabled
# Logs: journalctl -u macaroonie-domains
set -euo pipefail

if [[ $EUID -ne 0 ]]; then echo "Run as root: sudo bash $0" >&2; exit 1; fi

APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
STATE_DIR=/var/lib/macaroonie-domains
UNITS=/etc/systemd/system
APP_USER=$(stat -c %U "$APP_DIR")

for cmd in nginx certbot psql getent flock systemctl; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "Not installed: ${cmd}; domain sync not set up." >&2; exit 1; }
done

install -m 755 -o root -g root "${APP_DIR}/scripts/nginx-custom-domain.sh" /usr/local/sbin/macaroonie-domain
install -m 755 -o root -g root "${APP_DIR}/scripts/custom-domains-sync.sh" /usr/local/sbin/macaroonie-domains-sync

install -d -m 755 -o root -g root "$STATE_DIR"
# The API (running as the app user) writes this file to start a run now.
[[ -f "${STATE_DIR}/kick" ]] || : > "${STATE_DIR}/kick"
chown "$APP_USER" "${STATE_DIR}/kick"
chmod 644 "${STATE_DIR}/kick"

cat > "${UNITS}/macaroonie-domains.service" <<UNIT
[Unit]
Description=Macaroonie: switch tenants' custom domains on in nginx
After=network-online.target nginx.service postgresql.service
Wants=network-online.target

[Service]
Type=oneshot
Environment=APP_DIR=${APP_DIR}
ExecStart=/usr/local/sbin/macaroonie-domains-sync
TimeoutStartSec=15min
UNIT

cat > "${UNITS}/macaroonie-domains.timer" <<'UNIT'
[Unit]
Description=Macaroonie: custom domain sync every minute

[Timer]
OnBootSec=1min
OnUnitActiveSec=1min
AccuracySec=10s

[Install]
WantedBy=timers.target
UNIT

cat > "${UNITS}/macaroonie-domains.path" <<UNIT
[Unit]
Description=Macaroonie: custom domain sync when the admin asks

[Path]
PathChanged=${STATE_DIR}/kick
Unit=macaroonie-domains.service

[Install]
WantedBy=paths.target
UNIT

systemctl daemon-reload
systemctl enable --now macaroonie-domains.timer macaroonie-domains.path >/dev/null
echo "Custom domain sync installed: every minute, and on Verify DNS. Logs: journalctl -u macaroonie-domains"
