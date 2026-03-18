// src/config/db.js
//
// postgres.js client.
// Every request that touches tenant data must call db.withTenant(tenantId, fn)
// which wraps the work in a transaction with SET LOCAL app.tenant_id = '...'
// so RLS policies fire correctly on every query.

import postgres from 'postgres'
import { env } from './env.js'

export const sql = postgres(env.DATABASE_URL, {
  max:         20,
  idle_timeout: 30,
  // transform: postgres.camel  ← enable if you want snake_case → camelCase auto-mapping
})

/**
 * Run `fn(tx)` inside a transaction with tenant RLS context set.
 * Use this for every query that involves tenant-scoped tables.
 *
 * @example
 * const rows = await withTenant(tenantId, tx =>
 *   tx`SELECT * FROM venues WHERE id = ${venueId}`
 * )
 */
export async function withTenant(tenantId, fn) {
  return sql.begin(async tx => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

/**
 * Run `fn(tx)` in a transaction WITHOUT tenant context.
 * Only for tenant-resolution queries (looking up tenant by slug/auth0_org_id).
 */
export async function withTx(fn) {
  return sql.begin(fn)
}
