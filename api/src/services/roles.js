// src/services/roles.js
//
// Roles for "who can see this" lists: menu links (nav_items), Overview tiles
// (dashboard_tiles) and dashboards (hs_dashboards, migration 229) each keep
// hidden_role_ids, the tenant_roles that don't see them.
//
//   effectiveRoleId(req)          the caller's role: their custom role when
//                                 set, else the built-in role for users.role
//                                 (null: no role row, nothing hidden from them)
//   ownRoleIds(tx, tenantId, ids) the ids, each checked to be one of the
//                                 tenant's roles (400 otherwise), duplicates
//                                 dropped

import { withTenant } from '../config/db.js'
import { httpError } from '../middleware/error.js'

export async function effectiveRoleId(req) {
  if (!req.tenantId || !req.user?.sub) return null
  const [row] = await withTenant(req.tenantId, tx => tx`
    SELECT COALESCE(u.custom_role_id, r.id) AS role_id
      FROM users u
 LEFT JOIN tenant_roles r ON r.tenant_id  = u.tenant_id
                         AND r.key        = u.role::text
                         AND r.is_builtin = true
     WHERE u.auth0_user_id = ${req.user.sub}
       AND u.tenant_id     = ${req.tenantId}
       AND u.is_active     = true
     LIMIT 1
  `)
  return row?.role_id ?? null
}

export async function ownRoleIds(tx, tenantId, ids) {
  const list = [...new Set(ids ?? [])]
  if (!list.length) return []
  const rows = await tx`
    SELECT id FROM tenant_roles WHERE tenant_id = ${tenantId} AND id = ANY(${list}::uuid[])
  `
  if (rows.length !== list.length) throw httpError(400, 'One of those roles isn\'t one of yours')
  return list
}
