// The real auth middleware with one change: requireAuth takes
// "Authorization: Bearer test:<auth0 sub>" (no Auth0, no JWT) plus the
// X-Tenant-Id header, and checks the person against users / platform_admins
// the way the real one does after verifying the token. Permissions, roles,
// modules and access tokens (Bearer mcp_...) are the real code.
export * from '../../src/middleware/auth.js?real'
import { requireAuth as realRequireAuth, ACCESS_TOKEN_PREFIX } from '../../src/middleware/auth.js?real'
import { sql, withTenant } from '../../src/config/db.js'

export async function requireAuth(req, reply) {
  // Pepper's access tokens (mcp_...) go through the real check.
  if ((req.headers.authorization || '').startsWith('Bearer ' + ACCESS_TOKEN_PREFIX)) return realRequireAuth(req, reply)
  const m = /^Bearer test:(.+)$/.exec(req.headers.authorization || '')
  if (!m) return reply.code(401).send({ error: 'Missing authorization header' })
  const sub = m[1]
  const header = req.headers['x-tenant-id'] || null
  const tid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(header || '') ? header : null
  const [pa] = await sql`SELECT id FROM platform_admins WHERE auth0_user_id = ${sub} AND is_active = true LIMIT 1`
  let user = null
  if (tid) [user] = await withTenant(tid, tx => tx`SELECT role, email, is_active FROM users WHERE auth0_user_id = ${sub} AND tenant_id = ${tid} LIMIT 1`)
  if (tid && !user && !pa) return reply.code(403).send({ error: 'Your account has not been set up for this organisation.' })
  if (user && !user.is_active) return reply.code(403).send({ error: 'Your account has been deactivated' })
  req.user = { sub, email: user?.email ?? sub + '@test.local', role: pa ? 'owner' : (user?.role ?? 'operator'), isPlatformAdmin: !!pa }
  req.tenantId = tid
  req.auth0OrgId = null
  req.isPlatformAdmin = !!pa
}
