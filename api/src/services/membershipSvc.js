// src/services/membershipSvc.js
// Cross-tenant membership via list_memberships_for_identity() (migration 071).
// Used by auth middleware and /api/me so a login with no Auth0 org can still
// resolve "which restaurants does this person belong to".

import { sql } from '../config/db.js'

export async function listMemberships(sub, email) {
  return sql`
    SELECT tenant_id AS id, name, slug, plan, auth0_org_id, is_active, role
      FROM list_memberships_for_identity(${sub ?? null}, ${email ?? null})
  `
}

export async function isMember(sub, email, tenantId) {
  if (!tenantId) return false
  const [row] = await sql`
    SELECT 1
      FROM list_memberships_for_identity(${sub ?? null}, ${email ?? null})
     WHERE tenant_id = ${tenantId}
     LIMIT 1
  `
  return !!row
}
