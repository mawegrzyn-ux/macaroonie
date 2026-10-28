// Two tenants made the way the platform makes them (POST /api/platform/
// tenants: roles, nav, tiles, allergens, tax, inventory and till defaults),
// with a venue each and one person per role. Empties the database first,
// so it refuses to run against a database whose name doesn't say test.
import { as, ok, sql } from './app.mjs'

export const PLATFORM = 'test-platform-admin'
export const A = { owner: 'a-owner', admin: 'a-admin', operator: 'a-operator', viewer: 'a-viewer' }
export const B = { owner: 'b-owner' }

export function assertTestDatabase() {
  const name = new URL(process.env.DATABASE_URL).pathname.slice(1)
  if (!/test/i.test(name)) throw new Error('The API tests empty the database: DATABASE_URL must name a test database (got "' + name + '").')
}

export async function resetAndSeed() {
  assertTestDatabase()
  await sql.begin(async tx => {
    await tx`SET LOCAL client_min_messages = warning`
    await tx`TRUNCATE tenants, platform_admins, platform_secrets, platform_settings, platform_interest, backlog_items, changelog_entries CASCADE`
  })
  await sql`INSERT INTO platform_admins (auth0_user_id, email, is_active) VALUES (${PLATFORM}, 'platform@test.local', true)`
  const pa = as(PLATFORM, null)
  const ids = {}
  for (const [key, name, slug] of [['a', 'Thai House', 'thai-house'], ['b', 'Other Co', 'other-co']]) {
    const res = await ok(pa.post('/api/platform/tenants', { name, slug, auto_provision: false }), 'create tenant ' + name)
    ids[key] = (res.tenant || res).id
  }
  const people = [...Object.entries(A).map(([role, sub]) => [role, sub, ids.a]), ['owner', B.owner, ids.b]]
  for (const [role, sub, tid] of people) {
    await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id) VALUES (${tid}, ${sub + '@test.local'}, ${role}, ${sub})`
  }
  return ids
}
