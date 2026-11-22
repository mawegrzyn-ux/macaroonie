#!/usr/bin/env bash
# A test environment of its own for one run of the API tests, so several
# agents (or a dev server and a test run) can share one computer without
# wiping each other's database, queues or files (docs/PARALLEL_WORK.md 4.5).
#
#   eval "$(scripts/test-env.sh kitchen)"   # then: cd api && npm test
#
# Makes the database macaroonie_test_<name> owned by maca_app, a role that
# isn't a superuser (rule 27: superusers skip row-level security), migrates
# it, and prints the environment to use: that DATABASE_URL, a Redis database
# and queue prefix of its own, and folders named after the run. Run it again
# to bring the database up to date; add --fresh to drop it and start again.
#
# Postgres is reached as an admin through PG_ADMIN_URL when it is set,
# otherwise as the postgres OS user (sudo -u postgres psql). Cloud sessions
# each have their own container and don't need this; it does no harm there.
set -euo pipefail

name="${1:-}"
fresh="${2:-}"
if [[ ! "$name" =~ ^[a-z0-9_]{1,30}$ ]]; then
  echo "usage: scripts/test-env.sh <name> [--fresh]   (name: a-z, 0-9, _)" >&2
  exit 2
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
db="macaroonie_test_${name}"
role="maca_app"
# The test role's password is not a secret: CI uses the same one.
url="postgres://${role}:${role}@localhost:5432/${db}"

admin() {
  if [[ -n "${PG_ADMIN_URL:-}" ]]; then psql "$PG_ADMIN_URL" -v ON_ERROR_STOP=1 -qAt "$@"
  else sudo -u postgres psql -v ON_ERROR_STOP=1 -qAt "$@"; fi
}

if [[ "$(admin -c "SELECT 1 FROM pg_roles WHERE rolname = '${role}'")" != "1" ]]; then
  admin -c "CREATE ROLE ${role} LOGIN PASSWORD '${role}'" >&2
fi
if [[ "$fresh" == "--fresh" ]]; then
  admin -c "DROP DATABASE IF EXISTS ${db} WITH (FORCE)" >&2
fi
if [[ "$(admin -c "SELECT 1 FROM pg_database WHERE datname = '${db}'")" != "1" ]]; then
  admin -c "CREATE DATABASE ${db} OWNER ${role}" >&2
fi

# A Redis database from 1 to 15 picked from the name (0 stays the dev
# server's), and a queue prefix of the run's own on top, in case two names
# land on the same number.
redis_db=$(( $(printf '%s' "$name" | cksum | cut -d' ' -f1) % 15 + 1 ))
redis_base="${REDIS_BASE_URL:-redis://localhost:6379}"

(cd "$root/api" && DATABASE_URL="$url" node scripts/migrate.js >&2)

tmp="${TMPDIR:-/tmp}"
cat <<EOF
export TEST_RUN=${name}
export DATABASE_URL=${url}
export REDIS_URL=${redis_base}/${redis_db}
export QUEUE_PREFIX=bull_${name}
export AUTH0_DOMAIN=ci.invalid
export AUTH0_AUDIENCE=https://api.ci.invalid
export STRIPE_SECRET_KEY=sk_test_ci
export NODE_ENV=test
export UPLOAD_DIR=${tmp}/macaroonie-uploads-${name}
export PRIVATE_DIR=${tmp}/macaroonie-private-${name}
EOF
