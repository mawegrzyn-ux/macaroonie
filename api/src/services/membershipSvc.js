// src/services/membershipSvc.js
// Which restaurants (tenants) an Auth0 identity belongs to, matched by sub
// and/or email: every tenant's users rows, so system mode (systemSql, see
// config/db.js). Used by auth middleware and /api/me so a login with no
// Auth0 org can still resolve "which restaurants does this person belong to".

import { systemSql } from '../config/db.js'

function memberships(sub, email) {
  return systemSql`
    SELECT t.id, t.name, t.slug, t.plan, t.auth0_org_id, t.is_active, u.role
      FROM users u
      JOIN tenants t ON t.id = u.tenant_id
     WHERE u.is_active = true
       AND t.is_active = true
       AND (
         (${sub ?? null}::text IS NOT NULL AND ${sub ?? ''} <> '' AND u.auth0_user_id = ${sub ?? null})
         OR (${email ?? null}::text IS NOT NULL AND ${email ?? ''} <> '' AND lower(u.email) = lower(${email ?? null}))
       )
     ORDER BY t.name
  `
}

export async function listMemberships(sub, email) {
  return memberships(sub, email)
}

export async function isMember(sub, email, tenantId) {
  if (!tenantId) return false
  return (await memberships(sub, email)).some(m => m.id === tenantId)
}
