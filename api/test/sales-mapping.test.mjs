// Sales from other tills, phase 2: the item mapping (docs/SALES_IMPORT.md 4,
// migration 292), against the stand-in Loyverse (support/fake-loyverse.mjs).
// An exact item rule; a variant to a dish plus options; variant and modifier
// axis rules; a combination to a combo; ignore and keep; a venue's rule
// beating the connection's; every mapped line's parts adding up to its net;
// a rule change re-maps from its effective_from (marked, queued, run);
// Preview writes nothing; the coverage figure; another tenant's dish,
// option and connection refused; View reads and previews, Manage changes.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startFakeLoyverse, TOKEN } from './support/fake-loyverse.mjs'

const fake = await startFakeLoyverse()
const { as, sql, ok, closeApp } = await import('./support/app.mjs')
const { resetAndSeed, A, B } = await import('./support/seed.mjs')
const { env } = await import('../src/config/env.js')
const { timing } = await import('../src/services/connectors/loyverse.js')
const svc = await import('../src/services/salesImportSvc.js')
const mapping = await import('../src/services/itemMappingSvc.js')
const { menuSaveBody } = await import('../src/routes/menus.js')

env.LOYVERSE_API_URL = fake.url
timing.paceMs = 0
timing.backoffMs = 1

const LOOKER = 'a-map-looker'
let ids, owner, other, looker, viewer, V, BV, conn, M, our, theirs, synced

const base = () => `/api/integrations/mapping/${conn.id}`
const line = async (receipt, kind = 'item') => (await sql`
  SELECT l.* FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id
   WHERE c.connection_id = ${conn.id} AND c.external_id = ${receipt} AND l.line_kind = ${kind} ORDER BY l.line_no`)[0]
const partsOf = async lineId => sql`SELECT * FROM ext_line_parts WHERE line_id = ${lineId} ORDER BY part_no`
const remap = async () => {
  const r = await mapping.remapConnection(ids.a, conn.id)
  assert.equal(r.skipped, undefined, 'a re-map was asked for')
  return r
}
const money = async () => JSON.stringify(await sql`
  SELECT c.external_id, c.total_pence, c.tax_pence, c.discount_pence,
         (SELECT json_agg(json_build_array(l.line_no, l.gross_pence, l.net_pence, l.tax_pence) ORDER BY l.line_no) FROM ext_check_lines l WHERE l.check_id = c.id) AS lines
    FROM ext_checks c WHERE c.connection_id = ${conn.id} ORDER BY c.external_id`)
const addRule = async (body, who = owner) => ok(who.post(base() + '/rules', body))

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  other = as(B.owner, ids.b)
  viewer = as(A.viewer, ids.a)
  V  = (await ok(owner.post('/api/venues', { name: 'Zqx Map', slug: 'zqx-map-sm', timezone: 'Europe/London' }))).id
  BV = (await ok(other.post('/api/venues', { name: 'Wvb Map', slug: 'wvb-map-sm', timezone: 'Europe/London' }))).id
  const viewRole = await ok(owner.post('/api/access/roles', { key: 'maplooker', label: 'Map looker', permissions: { cash_recon: 'view' } }))
  await sql`INSERT INTO users (tenant_id, email, role, auth0_user_id, custom_role_id)
            VALUES (${ids.a}, ${LOOKER + '@test.local'}, 'operator', ${LOOKER}, ${viewRole.id})`
  looker = as(LOOKER, ids.a)

  // Our menu: Flat white (300) with Size and Milk, Croissant (250), Extra
  // shot as an option, and a Coffee deal combo (500).
  const size = await ok(owner.post('/api/menus/variant-groups', { name: 'Size', options: [{ label: 'Regular', price_pence: 0 }, { label: 'Large', price_pence: 50 }] }))
  const milk = await ok(owner.post('/api/menus/variant-groups', { name: 'Milk', options: [{ label: 'Dairy', price_pence: 0 }, { label: 'Oat', price_pence: 40 }] }))
  const extras = await ok(owner.post('/api/menus/variant-groups', { name: 'Extras', options: [{ label: 'Shot', price_pence: 60 }] }))
  const menu = await ok(owner.post('/api/menus', { name: 'Cafe', slug: 'cafe-sm' }))
  M = menu.id
  const full = await ok(owner.get(`/api/menus/${M}`))
  await ok(owner.patch(`/api/menus/${M}`, { ...full, sections: [{ title: 'Coffee', items: [
    { name: 'Flat white', price_pence: 300, is_orderable: true, variant_groups: [{ group_id: size.id }, { group_id: milk.id }, { group_id: extras.id }] },
    { name: 'Croissant', price_pence: 250, is_orderable: true },
  ] }] }))
  const tree = await ok(owner.get(`/api/menus/${M}`))
  const fw = tree.sections[0].items[0]
  const body = menuSaveBody(tree)
  body.sections.push({ title: 'Deals', items: [{ name: 'Coffee deal', kind: 'combo', price_pence: 500, is_orderable: true,
    combo: { mode: 'manual', steps: [{ id: randomUUID(), name: 'Coffee', min: 1, max: 1, options: [{ id: randomUUID(), type: 'item', item_id: fw.id }] }] } }] })
  await ok(owner.patch(`/api/menus/${M}`, body))
  const again = await ok(owner.get(`/api/menus/${M}`))
  const opt = (g, label) => g.options.find(o => o.label === label).id
  our = {
    fw: fw.id, croissant: again.sections[0].items[1].id, deal: again.sections[1].items[0].id,
    size: size.id, milk: milk.id, extras: extras.id,
    regular: opt(size, 'Regular'), large: opt(size, 'Large'), dairy: opt(milk, 'Dairy'), oat: opt(milk, 'Oat'), shot: opt(extras, 'Shot'),
  }
  // Tenant B's own dish and option, for the refusals.
  const bm = await ok(other.post('/api/menus', { name: 'B menu', slug: 'b-menu-sm' }))
  const bfull = await ok(other.get(`/api/menus/${bm.id}`))
  await ok(other.patch(`/api/menus/${bm.id}`, { ...bfull, sections: [{ title: 'B', items: [{ name: 'B dish', price_pence: 100, is_orderable: true }] }] }))
  const bg = await ok(other.post('/api/menus/variant-groups', { name: 'B size', options: [{ label: 'B large', price_pence: 10 }] }))
  theirs = { dish: (await ok(other.get(`/api/menus/${bm.id}`))).sections[0].items[0].id, option: bg.options[0].id, group: bg.id }

  // The connection, the venue on store st1, everything synced.
  conn = await ok(owner.post('/api/loyverse/connections', { name: 'Zqx Map Coffee', access_token: TOKEN }))
  await ok(owner.put(`/api/loyverse/venues/${V}/link`, { connection_id: conn.id, store_id: 'st1', day_starts_at: '04:00' }))
  const r = await svc.syncConnection(ids.a, conn.id)
  assert.equal(r.error, undefined, r.error)
  assert.equal(r.more, false)
  synced = await money()
})
after(async () => { await closeApp(); await fake.close() })

test('synced lines start unmapped; a modifier with no rule is a note', async () => {
  const item = await line('1-1001')
  assert.equal(item.map_state, 'unmapped')
  assert.equal(item.item_id, null)
  assert.equal((await line('1-1001', 'modifier')).map_state, 'note')
  const view = await ok(owner.get(base() + '?venue_id=' + V))
  assert.deepEqual(view.venues.map(v => v.venue_id), [V])
  const coffee = view.items.find(i => i.ref === 'it-coffee')
  assert.deepEqual(coffee.axes, ['Size', 'Milk'])
  assert.equal(coffee.variants.length, 2)
  assert.equal(coffee.state.state, 'unmapped')
  assert.ok(coffee.sales.net_pence > 0, 'last 30 days\' sales')
  assert.equal(view.modifiers[0].options.length, 2)
  const menu = await ok(owner.get(base() + '/menu?venue_id=' + V))
  assert.ok(menu.menus.some(m => m.id === M))
  assert.ok(menu.groups.some(g => g.id === our.size))
})

test('an exact item rule maps the croissant; the sync maps new receipts as they come', async () => {
  const rule = await addRule({ kind: 'exact', item_ref: 'it-croissant', target_item_id: our.croissant })
  const [c] = await sql`SELECT remap_from::text AS f FROM pos_connections WHERE id = ${conn.id}`
  assert.ok(c.f, 'the connection is marked for a re-map')
  const [first] = await sql`SELECT min(business_date)::text AS d FROM ext_checks WHERE connection_id = ${conn.id}`
  assert.equal(rule.effective_from, first.d, 'effective_from defaults to the first stored day')
  await remap()
  assert.equal((await sql`SELECT remap_from FROM pos_connections WHERE id = ${conn.id}`)[0].remap_from, null, 'cleared once done')
  const l = await line('1-1002')
  assert.deepEqual([l.map_state, l.item_id, l.rule_id, l.allocated_net_pence], ['mapped', our.croissant, rule.id, l.net_pence])
  assert.deepEqual((await partsOf(l.id)).map(p => [p.role, p.item_id, p.net_pence]), [['main', our.croissant, 250]])
  assert.equal(l.net_pence, 250, 'money untouched')

  // A new receipt arrives: mapped in the sync's own transaction.
  const r = fake.receipts.find(x => x.receipt_number === '1-1005')
  r.updated_at = new Date().toISOString()
  await svc.syncConnection(ids.a, conn.id)
  assert.equal((await line('1-1005')).map_state, 'mapped')
})

test('a variant to a dish plus options; the net is spread by our prices, the remainder on the dish', async () => {
  await addRule({ kind: 'exact', variant_ref: 'var-lrg-oat', target_item_id: our.fw, target_option_ids: [our.large, our.oat] })
  await remap()
  const l = await line('1-1001')
  assert.equal(l.item_ref, 'it-coffee')
  assert.equal(l.map_state, 'mapped')
  const parts = await partsOf(l.id)
  assert.deepEqual(parts.map(p => [p.role, p.item_id || p.option_id]), [['main', our.fw], ['option', our.large], ['option', our.oat]])
  const large = Math.trunc(666 * 50 / 390), oat = Math.trunc(666 * 40 / 390)
  assert.deepEqual(parts.map(p => p.net_pence), [666 - large - oat, large, oat])
  assert.equal(l.allocated_net_pence, 666 - large - oat)
  // The refund of one of them, the same way.
  const refundLine = await line('1-1003')
  assert.equal((await partsOf(refundLine.id)).reduce((s, p) => s + p.net_pence, 0), refundLine.net_pence)
})

test('axis rules: the item rule finds the dish, the variant\'s values and the modifier group add our options', async () => {
  await addRule({ kind: 'exact', item_ref: 'it-coffee', target_item_id: our.fw })
  await addRule({ kind: 'axis', axis_kind: 'variant', axis_name: 'Size', target_group_id: our.size,
    axis_values: [{ from: 'Regular', option_id: our.regular }, { from: 'Large', option_id: our.large }] })
  await addRule({ kind: 'axis', axis_kind: 'variant', axis_name: 'Milk', target_group_id: our.milk,
    axis_values: [{ from: 'Dairy', option_id: our.dairy }, { from: 'Oat', option_id: our.oat }] })
  await addRule({ kind: 'axis', axis_kind: 'modifier', axis_group_ref: 'mod-extras', target_group_id: our.extras,
    axis_values: [{ from: 'opt-shot', option_id: our.shot }] })
  await remap()
  const reg = await line('1-1004')
  assert.deepEqual((await partsOf(reg.id)).map(p => p.item_id || p.option_id), [our.fw, our.regular, our.dairy])
  // 1-1001 keeps its variant rule's options, and its Extra shot modifier joins as our Shot.
  const lo = await line('1-1001')
  const parts = await partsOf(lo.id)
  assert.deepEqual(parts.map(p => p.item_id || p.option_id), [our.fw, our.large, our.oat, our.shot])
  const mod = await line('1-1001', 'modifier')
  assert.deepEqual([mod.map_state, mod.option_id, mod.allocated_net_pence], ['mapped', our.shot, parts[3].net_pence])
  assert.equal(parts[3].source_line_id, mod.id)
  assert.equal(parts.reduce((s, p) => s + p.net_pence, 0), lo.net_pence)
})

test('a combination (large oat with an extra shot) becomes the combo; its modifier is part of it', async () => {
  const rule = await addRule({ kind: 'combination', variant_ref: 'var-lrg-oat', option_refs: ['opt-shot'], target_combo_id: our.deal })
  await remap()
  const l = await line('1-1001')
  assert.deepEqual([l.map_state, l.combo_id, l.item_id, l.rule_id], ['mapped', our.deal, null, rule.id])
  assert.deepEqual((await partsOf(l.id)).map(p => [p.role, p.combo_id, p.net_pence]), [['main', our.deal, 666]])
  assert.equal((await line('1-1001', 'modifier')).map_state, 'in_combo')
  // A dish can't be the combo, nor a combo the dish.
  assert.equal((await owner.post(base() + '/rules', { kind: 'combination', item_ref: 'it-croissant', option_refs: ['opt-syrup'], target_combo_id: our.fw })).status, 422)
  assert.equal((await owner.post(base() + '/rules', { kind: 'exact', item_ref: 'it-croissant', venue_id: V, target_item_id: our.deal })).status, 422)
})

test('keep and ignore; the venue\'s rule beats the connection\'s', async () => {
  // The croissant's connection rule becomes Keep; the venue gets its own exact rule.
  const view = await ok(owner.get(base()))
  const croissantRule = view.rules.find(r => r.item_ref === 'it-croissant' && r.kind === 'exact')
  await ok(owner.put(base() + '/rules/' + croissantRule.id, { kind: 'keep', item_ref: 'it-croissant' }))
  await remap()
  assert.equal((await line('1-1002')).map_state, 'kept')
  assert.equal((await partsOf((await line('1-1002')).id)).length, 0)
  const venueRule = await addRule({ kind: 'exact', item_ref: 'it-croissant', venue_id: V, target_item_id: our.croissant })
  await remap()
  const l = await line('1-1002')
  assert.deepEqual([l.map_state, l.rule_id], ['mapped', venueRule.id])
  // Ignored: not a sale. Deleting the venue rule (double confirmed on the page) falls back to the connection's.
  await ok(owner.put(base() + '/rules/' + croissantRule.id, { kind: 'ignore', item_ref: 'it-croissant' }))
  await ok(owner.delete(base() + '/rules/' + venueRule.id))
  await remap()
  assert.equal((await line('1-1002')).map_state, 'ignored')
  // One rule per thing and scope.
  assert.equal((await owner.post(base() + '/rules', { kind: 'keep', item_ref: 'it-croissant' })).status, 409)
})

test('every mapped item line\'s parts add up to its net exactly; money never changes', async () => {
  const rows = await sql`
    SELECT l.id, l.net_pence, COALESCE(sum(p.net_pence), 0)::int AS parts
      FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id LEFT JOIN ext_line_parts p ON p.line_id = l.id
     WHERE c.connection_id = ${conn.id} AND l.line_kind = 'item' AND l.map_state = 'mapped'
     GROUP BY l.id, l.net_pence`
  assert.ok(rows.length >= 4, 'mapped lines: ' + rows.length)
  for (const r of rows) assert.equal(r.parts, r.net_pence)
  assert.deepEqual(await money(), synced, 'every check\'s and line\'s money as synced')
})

test('Preview writes nothing and shows what changes', async () => {
  const snap = async () => JSON.stringify(await sql`
    SELECT l.id, l.map_state, l.item_id, l.option_id, l.combo_id, l.rule_id, l.allocated_net_pence,
           (SELECT json_agg(p ORDER BY p.part_no) FROM ext_line_parts p WHERE p.line_id = l.id) AS parts
      FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id WHERE c.connection_id = ${conn.id} ORDER BY l.id`)
  const before = await snap()
  const rulesBefore = (await sql`SELECT count(*)::int AS n FROM ext_map_rules WHERE connection_id = ${conn.id}`)[0].n
  const view = await ok(owner.get(base()))
  const croissant = view.rules.find(r => r.item_ref === 'it-croissant' && r.kind === 'ignore')
  // Draft: the croissant to the dish again instead of ignored.
  const p = await ok(looker.post(base() + '/preview', { venue_id: V, rules: [{ id: croissant.id, kind: 'exact', item_ref: 'it-croissant', target_item_id: our.croissant }] }))
  assert.ok(p.changed >= 1)
  assert.ok(p.changes.some(c => c.name.startsWith('Croissant') && c.before.state === 'ignored' && c.after.state === 'mapped' && c.after.target === 'Croissant'))
  assert.ok(p.after.mapped > p.before.mapped)
  assert.ok(p.by_target.some(t => t.id === our.croissant && t.net_pence > 0))
  // Leaving a rule out in the draft unmaps what it mapped.
  const gone = await ok(owner.post(base() + '/preview', { remove: [croissant.id] }))
  assert.ok(gone.changes.some(c => c.after.state === 'unmapped'))
  assert.equal(await snap(), before, 'nothing written')
  assert.equal((await sql`SELECT count(*)::int AS n FROM ext_map_rules WHERE connection_id = ${conn.id}`)[0].n, rulesBefore)
  // A draft is checked as a save is.
  assert.equal((await owner.post(base() + '/preview', { rules: [{ kind: 'exact', item_ref: 'it-croissant', target_item_id: theirs.dish }] })).status, 422)
})

test('a rule change re-maps only from its effective_from', async () => {
  const [early] = await sql`SELECT business_date::text AS d FROM ext_checks WHERE connection_id = ${conn.id} AND external_id = '1-1005'`
  const [late] = await sql`SELECT business_date::text AS d FROM ext_checks WHERE connection_id = ${conn.id} AND external_id = '1-1002'`
  assert.ok(early.d < late.d)
  const view = await ok(owner.get(base()))
  const croissant = view.rules.find(r => r.item_ref === 'it-croissant' && r.kind === 'ignore')
  // The croissant is a dish again, but only from 1-1002's day: 1-1005 falls back to nothing.
  await ok(owner.put(base() + '/rules/' + croissant.id, { kind: 'exact', item_ref: 'it-croissant', target_item_id: our.croissant, effective_from: late.d }))
  const [c] = await sql`SELECT remap_from::text AS f FROM pos_connections WHERE id = ${conn.id}`
  assert.equal(c.f, croissant.effective_from, 'from the earlier of the old and new effective_from')
  await remap()
  assert.equal((await line('1-1002')).item_id, our.croissant)
  assert.equal((await line('1-1005')).map_state, 'unmapped')
  // From 1-1005's day: it follows.
  await ok(owner.put(base() + '/rules/' + croissant.id, { kind: 'exact', item_ref: 'it-croissant', target_item_id: our.croissant, effective_from: early.d }))
  assert.equal((await sql`SELECT remap_from::text AS f FROM pos_connections WHERE id = ${conn.id}`)[0].f, early.d)
  await remap()
  assert.equal((await line('1-1005')).item_id, our.croissant)
})

test('coverage: the share of the last 30 days\' item sales value decided, by venue; unmapped items by value', async () => {
  // Unmap the coffee item rule's variants by removing the item rule: Regular/Dairy goes unmapped.
  const view = await ok(owner.get(base()))
  const coffee = view.rules.find(r => r.kind === 'exact' && r.item_ref === 'it-coffee' && !r.variant_ref)
  const before = await ok(owner.get(base() + '/coverage'))
  await ok(owner.delete(base() + '/rules/' + coffee.id))
  await remap()
  const cov = await ok(looker.get(base() + '/coverage'))
  const [want] = await sql`
    SELECT COALESCE(sum(l.net_pence), 0)::int AS total,
           COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state IN ('mapped', 'kept')), 0)::int AS decided,
           COALESCE(sum(l.net_pence) FILTER (WHERE l.map_state = 'ignored'), 0)::int AS ignored
      FROM ext_check_lines l JOIN ext_checks c ON c.id = l.check_id
     WHERE c.connection_id = ${conn.id} AND l.line_kind = 'item' AND c.kind = 'sale' AND NOT c.cancelled
       AND c.business_date >= current_date - 30`
  assert.equal(cov.venues.length, 1)
  assert.equal(cov.venues[0].total, want.total)
  assert.equal(cov.venues[0].percent, Math.round((want.decided / (want.total - want.ignored)) * 1000) / 10)
  assert.ok(cov.venues[0].percent < 100)
  assert.ok(cov.venues[0].percent < before.venues[0].percent, 'coverage moved down')
  // The Integrations page shows the same figure for the connection.
  const [listed] = (await ok(owner.get('/api/integrations/connections'))).connections
  assert.deepEqual([listed.mapping.percent, listed.mapping.rules > 0], [cov.all.percent, true])
  assert.equal(cov.all.percent, cov.venues[0].percent)
  assert.equal(cov.unmapped[0].variant_ref, 'var-reg-dairy')
  assert.equal(cov.unmapped[0].net_pence, 290)
})

test('another tenant\'s dish, option, group and connection are refused', async () => {
  for (const body of [
    { kind: 'exact', item_ref: 'it-croissant', venue_id: V, target_item_id: theirs.dish },
    { kind: 'exact', variant_ref: 'var-reg-dairy', target_item_id: our.fw, target_option_ids: [theirs.option] },
    { kind: 'exact', option_ref: 'opt-syrup', target_option_ids: [theirs.option] },
    { kind: 'axis', axis_kind: 'variant', axis_name: 'Size', item_ref: 'it-coffee', target_group_id: theirs.group, axis_values: [{ from: 'Large', option_id: theirs.option }] },
    { kind: 'exact', item_ref: 'it-not-there', target_item_id: our.fw },
    { kind: 'exact', item_ref: 'it-croissant', venue_id: BV, target_item_id: our.croissant },
  ]) {
    const r = await owner.post(base() + '/rules', body)
    // Another tenant's venue is refused before the route (refuseOtherTenantsVenues).
    assert.equal(r.status, body.venue_id === BV ? (r.status === 404 ? 404 : 422) : 422, JSON.stringify(body) + ' ' + r.body)
  }
  const ruleId = (await ok(owner.get(base()))).rules[0].id
  for (const [method, url, body] of [
    ['get', base(), null], ['get', base() + '/menu', null], ['get', base() + '/coverage', null],
    ['post', base() + '/preview', {}], ['post', base() + '/rules', { kind: 'ignore', item_ref: 'it-croissant' }],
    ['put', base() + '/rules/' + ruleId, { kind: 'ignore', item_ref: 'it-croissant' }], ['delete', base() + '/rules/' + ruleId, null],
  ]) {
    const r = body ? await other[method](url, body) : await other[method](url)
    assert.equal(r.status, 404, method + ' ' + url)
  }
  assert.ok((await sql`SELECT 1 FROM ext_map_rules WHERE id = ${ruleId}`).length, 'still there')
  assert.equal((await sql`SELECT count(*)::int AS n FROM ext_map_rules WHERE tenant_id = ${ids.b}`)[0].n, 0)
})

test('permissions: View reads and previews, Manage changes; no Cash reconciliation, nothing', async () => {
  assert.equal((await looker.get(base())).status, 200)
  assert.equal((await looker.get(base() + '/menu')).status, 200)
  assert.equal((await looker.post(base() + '/rules', { kind: 'keep', item_ref: 'it-coffee' })).status, 403)
  const ruleId = (await ok(owner.get(base()))).rules[0].id
  assert.equal((await looker.put(base() + '/rules/' + ruleId, { kind: 'keep', item_ref: 'it-coffee' })).status, 403)
  assert.equal((await looker.delete(base() + '/rules/' + ruleId)).status, 403)
  assert.equal((await viewer.get(base())).status, 403)
  assert.equal((await viewer.post(base() + '/preview', {})).status, 403)
})

test('saving a rule queues the re-map on the sales-sync queue; the sweep runs one whose job was lost', async () => {
  const { queue } = await import('../src/jobs/sales-sync.js')
  await queue.drain().catch(() => {})
  const r = await addRule({ kind: 'ignore', option_ref: 'opt-syrup' })
  let jobs = []
  for (let i = 0; i < 20 && !jobs.length; i++) {
    await new Promise(res => setTimeout(res, 100))
    jobs = (await queue.getJobs(['waiting', 'delayed', 'prioritized'])).filter(j => j.name === 'remap' && j.data.connectionId === conn.id)
  }
  assert.equal(jobs.length, 1, 'a remap job for the connection')
  await queue.drain().catch(() => {})
  assert.ok(await mapping.sweepRemaps() >= 1)
  assert.equal((await sql`SELECT remap_from FROM pos_connections WHERE id = ${conn.id}`)[0].remap_from, null)
  assert.ok(r.id)
})
