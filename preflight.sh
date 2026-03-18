#!/bin/bash
# =============================================================
# preflight.sh
# Applies all small outstanding fixes before first Claude Code run.
# Run from the project root: bash preflight.sh
# =============================================================

set -euo pipefail
GREEN='\033[0;32m'; BLUE='\033[0;34m'; NC='\033[0m'
log()  { echo -e "${GREEN}[✓]${NC} $1"; }
info() { echo -e "${BLUE}[→]${NC} $1"; }

# ── 1. Add auth0_org_id to migration 001 ─────────────────────
info "Patching 001_tenants_users.sql..."
if ! grep -q "auth0_org_id" migrations/001_tenants_users.sql; then
  cat >> migrations/001_tenants_users.sql << 'SQL'

-- Auth0 organization ID — maps Auth0 org to internal tenant
-- Added post-generation; required for Auth0 JWT → tenant resolution
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auth0_org_id text UNIQUE;
SQL
  log "auth0_org_id column added to 001_tenants_users.sql"
else
  log "auth0_org_id already present in 001 — skipping"
fi

# ── 2. Fix Rules.jsx ESM require() issue ─────────────────────
info "Patching admin/src/pages/Rules.jsx..."
# Replace the broken require('react') helper with a proper hook
python3 - << 'PYTHON'
import re

with open('admin/src/pages/Rules.jsx', 'r') as f:
    content = f.read()

# Replace the broken helper at the bottom
old = """// Helper: initialise state from first array item
function useStateFromFirst(items) {
  const { useState, useEffect } = require('react')
  const [value, setValue] = useState(null)
  useEffect(() => { if (items.length && !value) setValue(items[0].id) }, [items])
  return [value, setValue]
}"""

new = """// Hook: initialise venue state from first array item
function useVenueId(venues) {
  const [venueId, setVenueId] = useState(null)
  useEffect(() => {
    if (venues.length && !venueId) setVenueId(venues[0].id)
  }, [venues])
  return [venueId, setVenueId]
}"""

if old in content:
    content = content.replace(old, new)
    # Also fix the call site
    content = content.replace(
        "const [venueId, setVenueId] = useStateFromFirst(venues)",
        "const [venueId, setVenueId] = useVenueId(venues)"
    )
    with open('admin/src/pages/Rules.jsx', 'w') as f:
        f.write(content)
    print("Fixed")
else:
    print("Pattern not found — may already be fixed or file differs")
PYTHON
log "Rules.jsx patched"

# ── 3. Activate pg_cron sweep (commented reminder) ───────────
info "pg_cron note: uncomment the cron.schedule line in migrations/006_functions.sql"
info "  after confirming pg_cron extension is available on your Postgres instance."
info "  Line to uncomment: SELECT cron.schedule('sweep-holds', ...);"

# ── 4. Remind about missing route pastes ─────────────────────
echo ""
echo -e "${BLUE}Manual steps still needed:${NC}"
echo "  1. Paste routes from admin/INTEGRATION_PATCH.js into:"
echo "       api/src/routes/bookings.js  (PATCH /:id/move)"
echo "       api/src/routes/venues.js    (GET|PATCH /:id/rules, /:id/deposit-rules)"
echo ""
echo "  2. Add table_id subquery to api/src/routes/slots.js"
echo "       See Option A SQL in admin/INTEGRATION_PATCH.js"
echo ""
echo "  3. Add broadcastBooking() calls after booking mutations:"
echo "       api/src/routes/bookings.js  (POST /, PATCH /:id/status, PATCH /:id/move)"
echo "       api/src/routes/payments.js  (handlePaymentSucceeded)"
echo ""
echo -e "${GREEN}preflight.sh complete.${NC}"
