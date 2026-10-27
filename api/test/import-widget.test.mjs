// The import widget (migration 212): 'cash_import' can go on every kind of
// dashboard, needs Cash reconciliation view to be added, and week-detail
// says when Loyverse / GloriaFood last filled each day (`filled`), which is
// what the widget lists. Also checks every widget type in WIDGET_MODULE is
// allowed by the table's CHECK, so the two lists can't drift.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { as, sql, ok, closeApp } from './support/app.mjs'
import { resetAndSeed, A, B } from './support/seed.mjs'
import { fillTenant } from './support/fixtures.mjs'
import { WIDGET_TYPES } from '../src/routes/hsDashboards.js'

const MONDAY = '2026-10-19'
const TUESDAY = '2026-10-20'
let ids, owner, V, income

before(async () => {
  ids = await resetAndSeed()
  const filled = await fillTenant(A.owner, ids.a)
  assert.deepEqual(filled.failed, [], 'fixtures')
  owner = as(A.owner, ids.a)
  V = filled.ids.venue
  const config = await ok(owner.get(`/api/venues/${V}/cash-recon/config`))
  income = config.income_sources.find(s => s.is_active)
  assert.ok(income, 'an income source from the fixtures')
})
after(closeApp)

test('every widget type, the import widget included, goes on a dashboard', async () => {
  assert.ok(WIDGET_TYPES.includes('cash_import'))
  const d = await ok(owner.post('/api/cash-dashboards/dashboards', { venue_id: V, name: 'Every widget' }))
  for (const type of WIDGET_TYPES.filter(t => t !== 'checklist')) {
    await ok(owner.post(`/api/cash-dashboards/dashboards/${d.id}/widgets`, { widget_type: type }), type)
  }
  // And on the other kinds, with its options saved.
  for (const kind of ['hs', 'rota', 'custom']) {
    const k = await ok(owner.post(`/api/${kind}-dashboards/dashboards`, { venue_id: V, name: 'Import ' + kind }))
    const w = await ok(owner.post(`/api/${kind}-dashboards/dashboards/${k.id}/widgets`, { widget_type: 'cash_import' }))
    const p = await ok(owner.patch(`/api/${kind}-dashboards/dashboards/${k.id}/widgets/${w.id}`, { settings: { hide_days: true, hide_loyverse: true } }))
    assert.deepEqual(p.settings, { hide_days: true, hide_loyverse: true }, kind)
  }
  const [row] = await sql`SELECT jsonb_typeof(settings) AS t FROM hs_dashboard_widgets WHERE widget_type = 'cash_import' AND settings <> '{}'::jsonb LIMIT 1`
  assert.equal(row.t, 'object', 'settings stored as an object')
})

test('adding it needs Cash reconciliation: view is enough to add, filling needs manage', async () => {
  const roles = await ok(owner.get('/api/access/roles'))
  const op = roles.find(r => r.key === 'operator')
  const operator = as(A.operator, ids.a)
  const d = await ok(owner.post('/api/custom-dashboards/dashboards', { venue_id: V, name: 'Operator board' }))
  try {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...op.permissions, cash_recon: 'none', custom_dashboard: 'manage' } }))
    const refused = await operator.post(`/api/custom-dashboards/dashboards/${d.id}/widgets`, { widget_type: 'cash_import' })
    assert.equal(refused.status, 403, 'no Cash reconciliation: refused')

    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: { ...op.permissions, cash_recon: 'view', custom_dashboard: 'manage' } }))
    await ok(operator.post(`/api/custom-dashboards/dashboards/${d.id}/widgets`, { widget_type: 'cash_import' }), 'view adds it')
    const detail = await ok(operator.get(`/api/venues/${V}/cash-recon/week-detail/${MONDAY}`))
    assert.ok(detail.days[MONDAY].filled, 'view reads the fill times')
    const fill = await operator.post(`/api/gloriafood/venues/${V}/apply`, { dates: [MONDAY] })
    assert.equal(fill.status, 403, 'view: no filling')
  } finally {
    await ok(owner.patch('/api/access/roles/' + op.id, { permissions: op.permissions }))
  }
})

test('week-detail says when each source last filled a day', async () => {
  const before = await ok(owner.get(`/api/venues/${V}/cash-recon/week-detail/${MONDAY}`))
  assert.deepEqual(before.days[MONDAY].filled, { loyverse: null, gloriafood: null }, 'nothing filled yet')

  await ok(owner.put(`/api/gloriafood/venues/${V}/link`, {
    method: 'push', mappings: { income: { [income.id]: [{ sign: 1, kind: 'total' }] } },
  }))
  const r = await ok(owner.post(`/api/gloriafood/venues/${V}/apply`, { dates: [MONDAY, TUESDAY] }))
  assert.deepEqual(r.filled, [MONDAY, TUESDAY])

  const after = await ok(owner.get(`/api/venues/${V}/cash-recon/week-detail/${MONDAY}`))
  for (const date of [MONDAY, TUESDAY]) {
    const f = after.days[date].filled
    assert.equal(f.loyverse, null, date)
    assert.ok(f.gloriafood?.at && !Number.isNaN(Date.parse(f.gloriafood.at)), date + ' has a time')
    assert.equal(typeof f.gloriafood.by, 'string', date + ' says who')
  }

  // A submitted day isn't filled again, so its time stays.
  const firstAt = after.days[TUESDAY].filled.gloriafood.at
  await ok(owner.post(`/api/venues/${V}/cash-recon/daily/${TUESDAY}/submit`, {}))
  const again = await ok(owner.post(`/api/gloriafood/venues/${V}/apply`, { dates: [TUESDAY] }))
  assert.deepEqual(again.filled, [])
  const later = await ok(owner.get(`/api/venues/${V}/cash-recon/week-detail/${MONDAY}`))
  assert.equal(later.days[TUESDAY].filled.gloriafood.at, firstAt)
})

test('another tenant reads nothing of it', async () => {
  const other = as(B.owner, ids.b)
  const r = await other.get(`/api/venues/${V}/cash-recon/week-detail/${MONDAY}`)
  assert.equal(r.status, 404)
  const link = await other.get(`/api/gloriafood/venues/${V}/link`)
  assert.equal(link.status, 404)
})
