// The cross-tenant sweep. Tenants A and B are filled through the API first
// (support/fixtures.mjs, B with its own mark so A's stays unique); then
// tenant B's owner:
//   1. calls every route that takes a parameter with A's ids, and with B's
//      own ids mixed in (B's venue with A's sitting, ...): nothing B gets
//      back may contain A's data and none of A's rows may change;
//   2. sends every write A made again, as B: as A sent it, and with each of
//      A's ids in the address swapped for B's own (valid bodies, so the
//      route gets past its checks to the part that matters);
// and at the end none of B's rows may point at one of A's. Ids come from
// every table with a tenant_id, so a new table is swept as soon as the
// fixtures make a row in it.
//
// Public routes (the booking widget, online ordering, the website, devices,
// webhooks) are left out: they are reached by an id or token by design and
// ignore the person and tenant.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, getApp, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant, MARK } from './support/fixtures.mjs'

const PUBLIC = [
  /^\/widget-api\//, /^\/order-api\//, /^\/ai-api\//, /^\/screen-api\//, /^\/pos-api\//, /^\/webhooks\//,
  /^\/mcp/, /^\/\.well-known\//, /^\/manage\//, /^\/reservations\//, /^\/locations\//, /^\/p\//, /^\/order\//,
  /^\/_staging\//, /^\/uploads\//, /^\/lib\//, /^\/api\/site\//,
  /^\/api\/menus\/public\//, /^\/api\/menus\/:id\/print$/, /^\/api\/menus\/preview\//,
]
// Changes another tenant may make on purpose, with why.
const ALLOWED_CHANGES = {
  'POST /api/feature-requests/:id/upvote': 'feature requests are one board every restaurant group sees and upvotes',
}
// Tables where a row of one tenant may point at another tenant's row, with why.
const ALLOWED_REFERENCES = {
  feature_request_upvotes: 'an upvote on the shared feature request board',
}
const B_MARK = 'Wvb'
const DATE  = /^(date|week|week_start|weekStart|day)$/
const SLUG  = /^(slug|venueSlug|tenantSlug|pageSlug)$/
const OTHER = { dow: ['1'], type: ['bounces'], email: ['nobody@zqx.test'], gateway: ['demo'], key: ['x'], token: ['x'] }
// Named id parameters and the tables their ids come from; anything else
// (:id) gets every id either tenant has.
const KINDS = {
  venueId: ['venues'], menuId: ['menus'], staffId: ['cash_staff'], potId: ['tip_pots'], itemId: ['menu_items', 'inv_items'],
  designId: ['menu_print_designs', 'screen_designs'], releaseId: ['menu_releases'], widgetId: ['hs_dashboard_widgets'],
  expenseId: ['cash_expenses'], holdId: ['booking_holds'], paymentId: ['payments', 'order_payments'], periodId: ['staff_rota_off'],
  dayId: ['pos_days'], tenantId: ['tenants'], userId: ['users'], sid: ['venue_sittings', 'override_sittings', 'exception_sittings'],
  eid: ['schedule_exceptions'], oid: ['schedule_date_overrides'],
}
const IDS_PER_TABLE = 1
const CONCURRENCY = 8
const MAX_CALLS_PER_ROUTE = 1500
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g
const NO_ID = '00000000-0000-0000-0000-000000000000'

let ctx

/** Every table with a tenant_id, and those of them with an id column. */
async function tenantTables() {
  const rows = await sql`
    SELECT c.table_name AS name,
           EXISTS (SELECT 1 FROM information_schema.columns i
                    WHERE i.table_schema = c.table_schema AND i.table_name = c.table_name AND i.column_name = 'id') AS has_id
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id'
     ORDER BY 1
  `
  return { all: rows.map(r => r.name), withId: rows.filter(r => r.has_id).map(r => r.name) }
}

/** { table: [ids] } for one tenant, a few per table (the ids the sweep tries). */
async function sampleIds(tables, tenantId) {
  const out = {}
  for (const t of tables) {
    const rows = await sql.unsafe(`SELECT id::text AS id FROM "${t}" WHERE tenant_id = $1 ORDER BY id LIMIT ${IDS_PER_TABLE}`, [tenantId])
    if (rows.length) out[t] = rows.map(r => r.id)
  }
  out.tenants = [tenantId]
  out.users = [...(out.users || []), ...(await sql`SELECT auth0_user_id FROM users WHERE tenant_id = ${tenantId}`).map(r => r.auth0_user_id)]
  return out
}

/** Every id one tenant has, with the table it is in. */
async function everyId(tables, tenantId) {
  const parts = tables.map(t => `SELECT '${t}' AS t, id::text AS id FROM "${t}" WHERE tenant_id = $1`)
  const rows = await sql.unsafe(parts.join(' UNION ALL '), [tenantId])
  return new Map([[tenantId, 'tenants'], ...rows.map(r => [r.id, r.t])])
}

/** One md5 per table over a tenant's rows. */
async function fingerprint(tables, tenantId) {
  const parts = tables.map(t => `SELECT '${t}' AS t, md5(coalesce(string_agg(x::text, ',' ORDER BY x::text), '')) AS h FROM "${t}" x WHERE tenant_id = $1`)
  const rows = await sql.unsafe(parts.join(' UNION ALL '), [tenantId])
  return Object.fromEntries(rows.map(r => [r.t, r.h]))
}

function changedTables(before, after) {
  return Object.keys(after).filter(t => after[t] !== before[t])
}

function product(lists) {
  return lists.reduce((acc, list) => acc.flatMap(a => list.map(v => [...a, v])), [[]])
}

const idsIn = (text, ids) => [...new Set(String(text).match(UUID) || [])].filter(id => ids.has(id))

before(async () => {
  const ids = await resetAndSeed()
  const filledA = await fillTenant(A.owner, ids.a)
  const filledB = await fillTenant(B.owner, ids.b, { mark: B_MARK, slug: 'wvb' })
  const tables = await tenantTables()
  const poolA = await sampleIds(tables.withId, ids.a)
  const poolB = await sampleIds(tables.withId, ids.b)
  const aIds = await everyId(tables.withId, ids.a)
  ctx = {
    ids, filledA, filledB, tables: tables.all, poolA, poolB, aIds,
    aValues: new Set([...aIds.keys(), ...poolA.users]),
    b: as(B.owner, ids.b),
    app: await getApp(),
  }
})

test('both tenants\' data is all made', () => {
  assert.deepEqual(ctx.filledA.failed, [], 'tenant A fixtures that failed')
  assert.deepEqual(ctx.filledB.failed, [], 'tenant B fixtures that failed')
  const unknown = Object.values(KINDS).flat().filter(t => t !== 'tenants' && !ctx.tables.includes(t))
  assert.deepEqual(unknown, [], 'KINDS names tables that don\'t exist')
})

test('no route gives tenant B tenant A\'s data or changes it', { timeout: 30 * 60_000 }, async t => {
  const { app, poolA, poolB, aIds, aValues, tables, ids, b } = ctx
  const slugs = ['thai-house', 'zqx-ware', 'zqx-hertford', 'zqx-about', 'zqx-site', 'zqx-lunch']
  const both = [...new Set([...Object.values(poolA).flat(), ...Object.values(poolB).flat()])]
  const routes = app.routeList.filter(r => r.method !== 'HEAD' && r.method !== 'OPTIONS' && r.url.includes(':') && !r.url.includes('*') && !PUBLIC.some(p => p.test(r.url)))
  t.diagnostic('tables with rows, A: ' + Object.keys(poolA).length + ', B: ' + Object.keys(poolB).length + ' of ' + tables.length + '; routes: ' + routes.length)

  const leaks = [], changes = [], crashes = []
  const statuses = {}
  let calls = 0
  let before = await fingerprint(tables, ids.a)
  for (const route of routes) {
    const names = [...route.url.matchAll(/:([A-Za-z_]+)/g)].map(m => m[1])
    const isId = names.map(n => !DATE.test(n) && !SLUG.test(n) && !OTHER[n])
    const values = names.map((n, i) => !isId[i] ? (DATE.test(n) ? ['2026-10-19'] : SLUG.test(n) ? slugs : OTHER[n])
      : KINDS[n] ? KINDS[n].flatMap(k => [...(poolA[k] || []), ...(poolB[k] || [])])
      : both)
    // Every combination with at least one of A's ids (B's alone is B's own data).
    let combos = product(values.map(v => (v.length ? v : [NO_ID])))
      .filter(c => !isId.some(Boolean) || c.some((v, i) => isId[i] && aValues.has(v)))
    if (combos.length > MAX_CALLS_PER_ROUTE) combos = combos.filter((_, i) => i % Math.ceil(combos.length / MAX_CALLS_PER_ROUTE) === 0)
    const key = route.method + ' ' + route.url
    const one = async combo => {
      let url = route.url
      names.forEach((n, i) => { url = url.replace(':' + n, encodeURIComponent(combo[i])) })
      const body = ['POST', 'PUT', 'PATCH'].includes(route.method) ? {} : undefined
      const res = await b.request(route.method, url, body)
      calls++
      statuses[res.status] = (statuses[res.status] || 0) + 1
      // 500 only: a 503 is a service this server has no settings for (Auth0, the AI key)
      if (res.status === 500) crashes.push(key + ' -> ' + url + ' ' + res.status + ' ' + (res.json?.error || ''))
      if (res.status < 300 && res.body) {
        const foreign = idsIn(res.body, aIds).filter(id => !url.includes(id))
        if (res.body.includes(MARK) || foreign.length) leaks.push(key + ' -> ' + url + ' ' + res.status + (foreign.length ? ' ids ' + foreign.slice(0, 3).join(',') : '') + ' ' + res.body.slice(0, 160))
      }
    }
    for (let i = 0; i < combos.length; i += CONCURRENCY) await Promise.all(combos.slice(i, i + CONCURRENCY).map(one))
    const after = await fingerprint(tables, ids.a)
    const changed = changedTables(before, after)
    if (changed.length && !ALLOWED_CHANGES[key]) changes.push(key + ' changed ' + changed.join(', '))
    before = after
  }
  t.diagnostic('calls: ' + calls + ', statuses: ' + JSON.stringify(statuses))
  assert.deepEqual(leaks, [], 'tenant A\'s data in replies to tenant B')
  assert.deepEqual(changes, [], 'tenant A\'s rows changed by tenant B')
  assert.deepEqual(crashes, [], 'routes that crashed on another tenant\'s ids')
})

test('every write tenant A made is refused when tenant B sends it', { timeout: 10 * 60_000 }, async t => {
  const { filledA, poolB, aIds, tables, ids, b } = ctx
  // A's write as A sent it, then with each of A's ids in the address swapped
  // for B's id from the same table, then with all of them swapped.
  const variants = []
  for (const w of filledA.writes) {
    const inUrl = idsIn(w.url, aIds)
    const bodyIds = idsIn(JSON.stringify(w.body ?? null), aIds)
    if (!inUrl.length && !bodyIds.length) continue
    variants.push(w)
    const swaps = inUrl.map(id => [id, poolB[aIds.get(id)]?.[0]]).filter(([, to]) => to)
    const swapped = list => list.reduce((url, [from, to]) => url.replaceAll(from, to), w.url)
    const urls = new Set([...swaps.map(s => swapped([s])), swapped(swaps)])
    urls.delete(w.url)
    for (const url of urls) if (idsIn(url, aIds).length || bodyIds.length) variants.push({ ...w, url })
  }
  const accepted = [], loose = [], leaks = [], changes = [], crashes = []
  let before = await fingerprint(tables, ids.a)
  for (const v of variants) {
    const key = v.method + ' ' + v.url
    const res = await b.request(v.method, v.url, v.body)
    if (res.status === 500) crashes.push(key + ' ' + res.status + ' ' + (res.json?.error || ''))
    if (res.status < 300) {
      // A record of A's named in the address and accepted is the bug; with
      // A's ids in the body only it may be fine (the last test decides).
      (idsIn(v.url, aIds).length ? accepted : loose).push(key + ' ' + res.status)
      const sent = v.url + JSON.stringify(v.body ?? null)
      const foreign = idsIn(res.body, aIds).filter(id => !sent.includes(id))
      if (foreign.length) leaks.push(key + ' ids ' + foreign.slice(0, 3).join(','))
    }
    const after = await fingerprint(tables, ids.a)
    const changed = changedTables(before, after)
    if (changed.length) changes.push(key + ' changed ' + changed.join(', '))
    before = after
  }
  t.diagnostic('sent ' + variants.length + ' requests from ' + filledA.writes.length + ' writes')
  if (loose.length) t.diagnostic('accepted, A\'s ids in the body only: ' + loose.join('; '))
  assert.deepEqual(changes, [], 'tenant A\'s rows changed by tenant B')
  assert.deepEqual(accepted, [], 'writes to tenant A\'s records accepted for tenant B')
  assert.deepEqual(leaks, [], 'tenant A\'s data in replies to tenant B')
  assert.deepEqual(crashes, [], 'writes that crashed')
})

test('none of tenant B\'s rows point at tenant A\'s', async () => {
  const { tables, aIds, ids } = ctx
  const found = []
  for (const tb of tables) {
    if (ALLOWED_REFERENCES[tb]) continue
    const rows = await sql.unsafe(`SELECT x::text AS r FROM "${tb}" x WHERE tenant_id = $1`, [ids.b])
    for (const { r } of rows) {
      const hits = idsIn(r, aIds)
      if (hits.length) found.push(tb + ': ' + hits.slice(0, 3).join(', ') + ' in ' + r.slice(0, 200))
    }
  }
  // Link tables without a tenant_id (table_combination_members): every row
  // they point at must be one tenant's.
  const links = await sql`
    SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
       AND c.conrelid::regclass::text <> ALL(${tables}) AND c.confrelid::regclass::text = ANY(${tables})
  `
  const byChild = Object.groupBy(links, l => l.child)
  for (const [child, fks] of Object.entries(byChild)) {
    if (fks.length < 2) continue
    const joins = fks.map((f, i) => `JOIN "${f.parent}" p${i} ON p${i}.id = x."${f.col}"`).join(' ')
    const differ = fks.slice(1).map((_, i) => `p${i + 1}.tenant_id <> p0.tenant_id`).join(' OR ')
    const rows = await sql.unsafe(`SELECT x::text AS r FROM "${child}" x ${joins} WHERE ${differ}`)
    for (const { r } of rows) found.push(child + ': links two tenants\' rows: ' + r.slice(0, 200))
  }
  assert.deepEqual(found, [], 'tenant B rows holding tenant A ids')
})

after(closeApp)
