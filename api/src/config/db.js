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
  if (!tenantId) {
    const err = new Error('No tenant selected')
    err.statusCode = 400
    throw err
  }
  return sql.begin(async tx => {
    await tx`SELECT set_config('app.tenant_id', ${tenantId}, true)`
    return fn(tx)
  })
}

/**
 * System mode (migration 176). Every table with a tenant_id forces RLS, so a
 * query sees only the rows of the transaction's tenant (withTenant()); on the
 * bare `sql` pool it sees none of them and can't write them. systemSql is a
 * second, small pool whose connections start in system mode
 * (app.bypass_rls = 'on', a connection startup parameter: no pooler sits in
 * front of Postgres; with a transaction-mode pooler this would have to become
 * a SET LOCAL per transaction). Only for work that crosses tenants on
 * purpose: finding the tenant from a token, slug, device or id; background
 * jobs and sweeps; the platform pages. Anything that knows its tenant uses
 * withTenant(), and a system query still filters tenant_id where it can.
 */
export const systemSql = postgres(env.DATABASE_URL, {
  max:          5,
  idle_timeout: 30,
  connection:   { 'app.bypass_rls': 'on' },
})

/** Run `fn(tx)` in a system-mode transaction (see systemSql). */
export async function withSystem(fn) {
  return systemSql.begin(fn)
}

/**
 * One statement in a tenant's transaction, as a tagged template:
 *   const [v] = await tenantSql(tenantId)`SELECT ... FROM venues WHERE id = ${id}`
 * Same as withTenant(tenantId, tx => tx`...`). Fragments made with `sql`
 * can go inside it.
 */
export function tenantSql(tenantId) {
  return (strings, ...values) => withTenant(tenantId, tx => tx(strings, ...values))
}
