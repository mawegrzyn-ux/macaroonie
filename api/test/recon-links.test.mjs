// Which Cash Recon fields other systems fill (services/reconLinks.js,
// GET /api/venues/:id/cash-recon/links): the till's Cash Recon link
// (pos_settings.recon_map), Loyverse and GloriaFood mappings. Shown on the
// Cash Recon settings tabs under each income source, payment channel and
// SC source.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, ok, sql, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'

let ids, owner, V, income, channel, sc, other, stream

before(async () => {
  ids = await resetAndSeed()
  owner = as(A.owner, ids.a)
  V = (await ok(owner.post('/api/venues', { name: 'Ware', slug: 'ware', timezone: 'Europe/London' }))).id
  income = await ok(owner.post(`/api/venues/${V}/cash-recon/config/income-sources`, { name: 'Food sales' }))
  channel = await ok(owner.post(`/api/venues/${V}/cash-recon/config/payment-channels`, { name: 'Card', type: 'card' }))
  sc = await ok(owner.post(`/api/venues/${V}/cash-recon/config/sc-sources`, { name: 'Service charge', type: 'service_charge' }))
  other = await ok(owner.post(`/api/venues/${V}/cash-recon/config/income-sources`, { name: 'Typed in' }))
  stream = await ok(owner.post(`/api/pos/venues/${V}/revenue-streams`, { name: 'Bar' }))
})
after(closeApp)

test('nothing linked: no systems, no fields', async () => {
  const links = await ok(owner.get(`/api/venues/${V}/cash-recon/links`))
  assert.deepEqual(links.fields, {})
  assert.equal(links.sources.filter(s => s.fields > 0).length, 0)
})

test('the till, GloriaFood and Loyverse each show on the fields they fill', async () => {
  // Store tech → Cash Recon link.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, {
    recon_map: {
      income: { [income.id]: ['all', '-refunds'] },
      takings: { [channel.id]: ['card_integrated', 'card_external'] },
      sc: { [sc.id]: ['service_charge'] },
    },
    recon_auto_fill: true,
  }), 'till recon map')
  // GloriaFood tab: push link with a mapping.
  await ok(owner.put(`/api/gloriafood/venues/${V}/link`, {
    method: 'push',
    mappings: {
      income: { [income.id]: [{ sign: 1, kind: 'subtotal' }] },
      takings: { [channel.id]: [{ sign: 1, kind: 'payment', ref: 'ONLINE' }, { sign: 1, kind: 'payment', ref: 'CARD' }] },
    },
  }), 'GloriaFood link')
  // Loyverse needs a live token to link through the API: written directly.
  const [conn] = await sql`INSERT INTO loyverse_connections (tenant_id, name, access_token, token_hint)
                           VALUES (${ids.a}, 'Shop', 'sealed-stand-in', 'abcd') RETURNING id`
  await sql`INSERT INTO loyverse_venue_links (tenant_id, venue_id, connection_id, store_id, mappings)
            VALUES (${ids.a}, ${V}, ${conn.id}, 'store-1', ${sql.json({
              sc: { [sc.id]: [{ sign: 1, kind: 'tips' }] },
              income: { [income.id]: [{ sign: 1, kind: 'net_sales' }, { sign: -1, kind: 'item', ref: 'i1', label: 'Gift card' }, { sign: 1, kind: 'nonsense' }] },
            })})`

  const links = await ok(owner.get(`/api/venues/${V}/cash-recon/links`))
  const by = key => Object.fromEntries((links.fields[key] || []).map(e => [e.source, e.terms]))

  assert.deepEqual(by('income:' + income.id), {
    pos: [{ label: 'All sales', sign: 1 }, { label: 'Refunds', sign: -1 }],
    loyverse: [{ label: 'Net sales', sign: 1 }, { label: 'Item: Gift card', sign: -1 }],
    gloriafood: [{ label: 'Food subtotal', sign: 1 }],
  })
  assert.deepEqual(by('takings:' + channel.id), {
    pos: [{ label: 'Card machine', sign: 1 }, { label: 'Card', sign: 1 }],
    gloriafood: [{ label: 'Payment: Paid online', sign: 1 }, { label: 'Payment: Card at the counter', sign: 1 }],
  })
  assert.deepEqual(by('sc:' + sc.id), {
    pos: [{ label: 'Service charge', sign: 1 }],
    loyverse: [{ label: 'Tips', sign: 1 }],
  })
  assert.equal(links.fields['income:' + other.id], undefined, 'a field nothing fills is left out')

  const src = Object.fromEntries(links.sources.map(s => [s.key, s]))
  assert.equal(src.pos.fields, 3)
  assert.equal(src.pos.where.route, '/pos/recon')
  assert.match(src.pos.note, /closed on the till/)
  assert.equal(src.gloriafood.fields, 2)
  assert.equal(src.gloriafood.where.tab, 'gloriafood')
  assert.equal(src.loyverse.fields, 2)

  // The till's revenue stream by name; one deleted since reads as such.
  await ok(owner.patch(`/api/pos/venues/${V}/settings`, {
    recon_map: { income: { [income.id]: [stream.id] }, takings: {}, sc: {} },
  }))
  const again = await ok(owner.get(`/api/venues/${V}/cash-recon/links`))
  assert.deepEqual(again.fields['income:' + income.id].find(e => e.source === 'pos').terms, [{ label: 'Sales: Bar', sign: 1 }])
  await sql`DELETE FROM pos_revenue_streams WHERE id = ${stream.id}`
  const gone = await ok(owner.get(`/api/venues/${V}/cash-recon/links`))
  assert.deepEqual(gone.fields['income:' + income.id].find(e => e.source === 'pos').terms,
    [{ label: 'Sales: a revenue stream no longer there', sign: 1 }])
})

test('who can read it: Cash Recon view, own venues only', async () => {
  await ok(as(A.operator, ids.a).get(`/api/venues/${V}/cash-recon/links`), 'operator reads')
  const otherGroup = await as(B.owner, ids.b).get(`/api/venues/${V}/cash-recon/links`)
  assert.equal(otherGroup.status, 404)
  const [role] = await sql`SELECT id, permissions FROM tenant_roles WHERE tenant_id = ${ids.a} AND key = 'operator'`
  await sql`UPDATE tenant_roles SET permissions = ${sql.json({ ...role.permissions, cash_recon: 'none' })} WHERE id = ${role.id}`
  try {
    const none = await as(A.operator, ids.a).get(`/api/venues/${V}/cash-recon/links`)
    assert.equal(none.status, 403)
  } finally {
    await sql`UPDATE tenant_roles SET permissions = ${sql.json(role.permissions)} WHERE id = ${role.id}`
  }
})
