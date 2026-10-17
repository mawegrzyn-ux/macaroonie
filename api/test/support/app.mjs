// The real app (with the test login, see auth-stub.mjs), and a client per
// person: as('u-owner-a', tenantId).get(url) -> { status, body, json }.
import { buildApp } from '../../src/app.js'
import { sql as appSql, systemSql } from '../../src/config/db.js'
import { INTERNAL_CALL_HEADER, INTERNAL_CALL_SECRET } from '../../src/middleware/auth.js'

// The tests read and write across tenants: the system-mode pool (RLS lets
// it see every tenant's rows; see systemSql in src/config/db.js).
export const sql = systemSql

let app = null
export async function getApp() {
  if (!app) {
    app = await buildApp()
    await app.ready()
  }
  return app
}

/** Requests as a person (auth0 sub) in a tenant. Not rate limited: the
 *  internal-call header the AI tools use keeps the tests out of the limit. */
export function as(sub, tenantId) {
  const request = async (method, url, body, headers = {}) => {
    const a = await getApp()
    const res = await a.inject({
      method, url,
      headers: {
        ...(sub ? { authorization: 'Bearer test:' + sub } : {}),
        ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        [INTERNAL_CALL_HEADER]: INTERNAL_CALL_SECRET,
        ...headers,
      },
      payload: body !== undefined ? JSON.stringify(body) : undefined,
    })
    let json = null
    try { json = res.json() } catch { json = null }
    return { status: res.statusCode, headers: res.headers, body: res.body, json }
  }
  const call = method => (url, body, headers) => request(method, url, body, headers)
  return { request, get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), delete: call('DELETE') }
}

/** Throws with the API's message unless the call succeeded. */
export async function ok(promise, what = 'request') {
  const res = await promise
  if (res.status >= 400) {
    const issues = res.json?.issues ? ' ' + JSON.stringify(res.json.issues) : ''
    throw new Error(what + ' failed: ' + res.status + ' ' + (res.json?.error || res.body?.slice(0, 200)) + issues)
  }
  return res.json
}

export async function closeApp() {
  try { await app?.close() } catch { /* already closed */ }
  app = null
  await appSql.end({ timeout: 2 })
  await systemSql.end({ timeout: 2 })
}
