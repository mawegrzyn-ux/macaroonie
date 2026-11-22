// What every area's fixtures share. fillTenant() (../fixtures.mjs) makes one
// context per tenant and hands it to each area's fill() in turn:
//   ctx.V          the tenant's first venue (core.mjs); nothing runs without it
//   ctx.ids        the ids fillTenant() returns (callers read ids.venue, ids.menu, ...)
//   ctx.made       rows one area made that a later area uses (made.dish, made.staff, ...)
//   ctx.step(name, fn)  runs one step; a failure is listed in ctx.failed, the rest go on
//   ctx.post / put / patch(url, body)  writes as the owner, kept in ctx.writes so the
//                  sweep can send each again as the other tenant
//   ctx.get(url)   a read (not kept)
//   ctx.c          the owner's client, for calls that aren't kept as writes
import { as, ok } from '../app.mjs'

// The week most rows are made in (rota, cash, deliveries, reports).
export const MONDAY = '2026-10-19'

export function newContext(sub, tenantId, { mark, slug, loyalty, reports }) {
  const c = as(sub, tenantId)
  const failed = []
  const ids = {}
  // Every write that worked, so the sweep can try each one again as
  // another tenant (valid bodies, pointing at this tenant's ids).
  const writes = []
  const write = (method, url, body, what) => ok(c[method.toLowerCase()](url, body), what || method + ' ' + url)
    .then(res => { writes.push({ method, url, body }); return res })
  const step = async (name, fn) => {
    try { return await fn() } catch (err) { failed.push(name + ': ' + err.message); return null }
  }
  return {
    sub, tenantId, mark, slug, withLoyalty: loyalty, withReports: reports,
    c, ids, failed, writes, made: {}, V: undefined,
    step,
    post: (url, body, what) => write('POST', url, body, what),
    put: (url, body, what) => write('PUT', url, body, what),
    patch: (url, body, what) => write('PATCH', url, body, what),
    get: (url, what) => ok(c.get(url), what || 'GET ' + url),
  }
}
